import type { EventStore } from "../ports/event-store.js";
import type { DriftReport } from "./drift-detector.js";
import {
  clearShadowVersion,
  evaluatePromotionWithArbitration,
  promoteShadow,
  rollback,
  toSnapshot,
  type ModelRegistry,
  type ModelRegistrySnapshot,
  type PromotionPolicy
} from "./model-registry.js";
import type { ArbitrationPolicy, ArbitrationDecision } from "./model-arbitration.js";
import type { NewProposalInput, ProposalRecord } from "../resource/proposal/queue.js";

export type LearningStage = "shadow" | "canary" | "proposal_required" | "promoted" | "rolled_back" | "held";
export type LearningAction = "none" | "start_canary" | "queue_proposal" | "promote" | "rollback" | "reject_candidate";
export type ManualOverrideDecision = "approve" | "reject";

export interface LearningOrchestratorInput {
  registry: ModelRegistry;
  modelName: string;
  currentCanaryVersion?: string;
  canaryTrafficPercent?: number;
  policy?: PromotionPolicy;
  arbitrationPolicy?: ArbitrationPolicy;
  driftReport?: {
    shouldAlert: DriftReport["shouldAlert"];
    alerts?: DriftReport["alerts"];
  };
  manualApprovalRequired?: boolean;
  manualOverride?: ManualOverrideDecision;
  actorId?: string;
}

export interface LearningOrchestratorDeps {
  eventStore?: EventStore;
  queueProposal?: (input: NewProposalInput) => Promise<ProposalRecord>;
  now?: () => Date;
}

export interface LearningOrchestratorResult {
  modelName: string;
  stage: LearningStage;
  action: LearningAction;
  reason: string;
  candidateVersion?: string;
  currentProductionVersion: string;
  previousVersion?: string;
  canaryTrafficPercent?: number;
  proposalId?: string;
  arbitration?: ArbitrationDecision;
  snapshot: ModelRegistrySnapshot;
  eventRecorded: boolean;
}

async function appendLearningEvent(
  eventStore: EventStore | undefined,
  modelName: string,
  eventType: string,
  payload: Record<string, unknown>,
  actorId?: string
): Promise<boolean> {
  if (!eventStore) return false;
  const streamId = `learning-orchestrator:${modelName}`;
  const existing = await eventStore.read(streamId, { limit: 1000 });
  await eventStore.append({
    streamId,
    eventType,
    expectedVersion: existing.length,
    actorId,
    payload
  });
  return true;
}

function buildProposalInput(input: {
  modelName: string;
  candidateVersion: string;
  productionVersion: string;
  reason: string;
  actorId?: string;
}): NewProposalInput {
  return {
    resourceType: "presets",
    name: `learning-promote:${input.modelName}@${input.candidateVersion}`,
    content: JSON.stringify(
      {
        modelName: input.modelName,
        candidateVersion: input.candidateVersion,
        productionVersion: input.productionVersion,
        reason: input.reason,
        requestedAction: "promote-shadow-model"
      },
      null,
      2
    ),
    confidence: 0.72,
    sourceEvent: "learning_orchestrator",
    origin: "learning-orchestrator",
    createdByActorId: input.actorId,
    requiredApprovalStages: ["reviewer", "admin"]
  };
}

export async function runLearningOrchestrator(
  input: LearningOrchestratorInput,
  deps: LearningOrchestratorDeps = {}
): Promise<LearningOrchestratorResult> {
  const entry = input.registry.get(input.modelName);
  if (!entry) {
    throw new Error(`unknown model: ${input.modelName}`);
  }

  const canaryTrafficPercent = Math.max(1, Math.min(100, Math.trunc(input.canaryTrafficPercent ?? 5)));
  const driftAlert = input.driftReport?.shouldAlert === true;

  if (driftAlert) {
    if (entry.history.length >= 2) {
      const rolledBack = rollback(input.registry, input.modelName);
      const eventRecorded = await appendLearningEvent(
        deps.eventStore,
        input.modelName,
        "learning.rollback.triggered",
        {
          from: rolledBack.from,
          to: rolledBack.to,
          alerts: input.driftReport?.alerts ?? []
        },
        input.actorId
      );
      return {
        modelName: input.modelName,
        stage: "rolled_back",
        action: "rollback",
        reason: `drift-alert:${(input.driftReport?.alerts ?? []).join(" | ") || "unknown"}`,
        currentProductionVersion: rolledBack.to,
        previousVersion: rolledBack.from,
        snapshot: toSnapshot(input.registry),
        eventRecorded
      };
    }

    return {
      modelName: input.modelName,
      stage: "held",
      action: "none",
      reason: `drift-alert-without-rollback-history:${(input.driftReport?.alerts ?? []).join(" | ") || "unknown"}`,
      currentProductionVersion: entry.productionVersion,
      snapshot: toSnapshot(input.registry),
      eventRecorded: false
    };
  }

  const evaluated = evaluatePromotionWithArbitration(input.registry, input.modelName, {
    policy: input.policy,
    arbitrationPolicy: input.arbitrationPolicy
  });

  if (!evaluated.promotion.ready || !evaluated.promotion.candidate) {
    return {
      modelName: input.modelName,
      stage: "shadow",
      action: "none",
      reason: evaluated.promotion.reason,
      currentProductionVersion: entry.productionVersion,
      snapshot: toSnapshot(input.registry),
      eventRecorded: false
    };
  }

  const candidateVersion = evaluated.promotion.candidate;
  const arbitration = evaluated.arbitration;

  if (input.manualOverride === "reject") {
    clearShadowVersion(input.registry, input.modelName, candidateVersion);
    const eventRecorded = await appendLearningEvent(
      deps.eventStore,
      input.modelName,
      "learning.candidate.rejected",
      { candidateVersion, productionVersion: entry.productionVersion },
      input.actorId
    );
    return {
      modelName: input.modelName,
      stage: "held",
      action: "reject_candidate",
      reason: "manual-override:reject",
      candidateVersion,
      currentProductionVersion: entry.productionVersion,
      arbitration,
      snapshot: toSnapshot(input.registry),
      eventRecorded
    };
  }

  if (!input.currentCanaryVersion || input.currentCanaryVersion !== candidateVersion) {
    const eventRecorded = await appendLearningEvent(
      deps.eventStore,
      input.modelName,
      "learning.canary.started",
      {
        candidateVersion,
        productionVersion: entry.productionVersion,
        trafficPercent: canaryTrafficPercent
      },
      input.actorId
    );
    return {
      modelName: input.modelName,
      stage: "canary",
      action: "start_canary",
      reason: "promotion-policy-satisfied; enter canary",
      candidateVersion,
      currentProductionVersion: entry.productionVersion,
      canaryTrafficPercent,
      arbitration,
      snapshot: toSnapshot(input.registry),
      eventRecorded
    };
  }

  if (input.manualApprovalRequired && input.manualOverride !== "approve") {
    const queued = deps.queueProposal
      ? await deps.queueProposal(
          buildProposalInput({
            modelName: input.modelName,
            candidateVersion,
            productionVersion: entry.productionVersion,
            reason: arbitration?.reason ?? evaluated.promotion.reason,
            actorId: input.actorId
          })
        )
      : undefined;
    const eventRecorded = await appendLearningEvent(
      deps.eventStore,
      input.modelName,
      "learning.promotion.proposal-requested",
      {
        candidateVersion,
        productionVersion: entry.productionVersion,
        proposalId: queued?.id ?? null
      },
      input.actorId
    );
    return {
      modelName: input.modelName,
      stage: "proposal_required",
      action: "queue_proposal",
      reason: "manual-approval-required",
      candidateVersion,
      currentProductionVersion: entry.productionVersion,
      proposalId: queued?.id,
      arbitration,
      snapshot: toSnapshot(input.registry),
      eventRecorded
    };
  }

  if (arbitration && arbitration.kind !== "promote") {
    return {
      modelName: input.modelName,
      stage: "held",
      action: "none",
      reason: arbitration.reason,
      candidateVersion,
      currentProductionVersion: entry.productionVersion,
      arbitration,
      snapshot: toSnapshot(input.registry),
      eventRecorded: false
    };
  }

  const promoted = promoteShadow(input.registry, input.modelName, candidateVersion);
  const eventRecorded = await appendLearningEvent(
    deps.eventStore,
    input.modelName,
    "learning.promoted",
    {
      previousVersion: promoted.previous,
      currentVersion: promoted.current,
      candidateVersion,
      canaryTrafficPercent
    },
    input.actorId
  );
  return {
    modelName: input.modelName,
    stage: "promoted",
    action: "promote",
    reason: arbitration?.reason ?? evaluated.promotion.reason,
    candidateVersion,
    currentProductionVersion: promoted.current,
    previousVersion: promoted.previous,
    canaryTrafficPercent,
    arbitration,
    snapshot: toSnapshot(input.registry),
    eventRecorded
  };
}
