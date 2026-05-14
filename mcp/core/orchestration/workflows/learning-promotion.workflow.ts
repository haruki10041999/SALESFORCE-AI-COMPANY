import type { EventStore } from "../../ports/event-store.js";
import type { OutboxPort } from "../../ports/outbox-port.js";
import type { ArbitrationPolicy } from "../../learning/model-arbitration.js";
import {
  rollback,
  restoreRegistryFromSnapshot,
  type ModelRegistrySnapshot,
  type PromotionPolicy
} from "../../learning/model-registry.js";
import {
  runLearningOrchestrator,
  type LearningOrchestratorResult,
  type ManualOverrideDecision
} from "../../learning/learning-orchestrator.js";
import type { NewProposalInput, ProposalRecord } from "../../resource/proposal/queue.js";

export interface LearningPromotionWorkflowInput {
  registrySnapshot: ModelRegistrySnapshot;
  modelName: string;
  currentCanaryVersion?: string;
  canaryTrafficPercent?: number;
  policy?: PromotionPolicy;
  arbitrationPolicy?: ArbitrationPolicy;
  driftReport?: {
    shouldAlert: boolean;
    alerts?: string[];
  };
  manualApprovalRequired?: boolean;
  manualOverride?: ManualOverrideDecision;
  actorId?: string;
}

export interface LearningPromotionWorkflowDeps {
  eventStore?: EventStore;
  outboxPort?: OutboxPort;
  queueProposal?: (input: NewProposalInput) => Promise<ProposalRecord>;
  createPolicySnapshotTag?: (input: {
    modelName: string;
    candidateVersion: string;
    productionVersion: string;
    reason: string;
    snapshot: ModelRegistrySnapshot;
  }) => Promise<string>;
  recordPromotionHistory?: (entry: {
    modelName: string;
    stage: LearningOrchestratorResult["stage"];
    action: LearningOrchestratorResult["action"];
    reason: string;
    candidateVersion?: string;
    currentProductionVersion: string;
    previousVersion?: string;
    policySnapshotTag?: string;
    dag: LearningPromotionDagNode[];
    occurredAt: string;
  }) => Promise<void>;
}

export interface LearningPromotionDagNode {
  node: "drift-check" | "ab-evaluation" | "policy-snapshot" | "promotion";
  status: "passed" | "skipped" | "failed";
  detail: string;
}

export interface LearningPromotionWorkflowResult extends LearningOrchestratorResult {
  dag: LearningPromotionDagNode[];
  policySnapshotTag?: string;
  promotionRolledBack?: boolean;
}

export async function runLearningPromotionWorkflow(
  input: LearningPromotionWorkflowInput,
  deps: LearningPromotionWorkflowDeps = {}
): Promise<LearningPromotionWorkflowResult> {
  const registry = restoreRegistryFromSnapshot(input.registrySnapshot);
  const dag: LearningPromotionDagNode[] = [];
  dag.push({
    node: "drift-check",
    status: input.driftReport?.shouldAlert ? "failed" : "passed",
    detail: input.driftReport?.shouldAlert
      ? `drift-alert:${(input.driftReport.alerts ?? []).join(" | ") || "unknown"}`
      : "no-drift-alert"
  });

  const driftReport = input.driftReport
    ? {
        shouldAlert: input.driftReport.shouldAlert,
        ...(input.driftReport.alerts ? { alerts: input.driftReport.alerts } : {})
      }
    : undefined;
  const result = await runLearningOrchestrator(
    {
      registry,
      modelName: input.modelName,
      currentCanaryVersion: input.currentCanaryVersion,
      canaryTrafficPercent: input.canaryTrafficPercent,
      policy: input.policy,
      arbitrationPolicy: input.arbitrationPolicy,
      driftReport,
      manualApprovalRequired: input.manualApprovalRequired,
      manualOverride: input.manualOverride,
      actorId: input.actorId
    },
    deps
  );

  dag.push({
    node: "ab-evaluation",
    status: result.candidateVersion ? "passed" : "skipped",
    detail: result.candidateVersion
      ? `candidate:${result.candidateVersion}; action:${result.action}`
      : "no-promotion-candidate"
  });

  let policySnapshotTag: string | undefined;
  let promotionRolledBack = false;

  if (result.action === "promote" && result.candidateVersion && deps.createPolicySnapshotTag) {
    try {
      policySnapshotTag = await deps.createPolicySnapshotTag({
        modelName: result.modelName,
        candidateVersion: result.candidateVersion,
        productionVersion: result.currentProductionVersion,
        reason: result.reason,
        snapshot: result.snapshot
      });
      dag.push({
        node: "policy-snapshot",
        status: "passed",
        detail: `tag:${policySnapshotTag}`
      });
    } catch (error) {
      dag.push({
        node: "policy-snapshot",
        status: "failed",
        detail: `snapshot-tag-failed:${String(error)}`
      });
      const rolledBack = rollback(registry, input.modelName);
      result.stage = "rolled_back";
      result.action = "rollback";
      result.reason = `snapshot-tag-failed:${String(error)}`;
      result.currentProductionVersion = rolledBack.to;
      result.previousVersion = rolledBack.from;
      result.snapshot = {
        ...result.snapshot,
        models: result.snapshot.models.map((model) => {
          if (model.name !== input.modelName) {
            return model;
          }
          return {
            ...model,
            productionVersion: rolledBack.to,
            history: [rolledBack.to, ...model.history.filter((version) => version !== rolledBack.to)]
          };
        })
      };
      promotionRolledBack = true;
    }
  } else {
    dag.push({
      node: "policy-snapshot",
      status: "skipped",
      detail: result.action === "promote" ? "snapshot-tagger-not-configured" : "not-promoted"
    });
  }

  dag.push({
    node: "promotion",
    status: result.action === "promote" ? "passed" : result.action === "rollback" ? "failed" : "skipped",
    detail: result.reason
  });

  if (deps.recordPromotionHistory) {
    await deps.recordPromotionHistory({
      modelName: result.modelName,
      stage: result.stage,
      action: result.action,
      reason: result.reason,
      candidateVersion: result.candidateVersion,
      currentProductionVersion: result.currentProductionVersion,
      previousVersion: result.previousVersion,
      policySnapshotTag,
      dag,
      occurredAt: new Date().toISOString()
    });
  }

  return {
    ...result,
    dag,
    ...(policySnapshotTag ? { policySnapshotTag } : {}),
    ...(promotionRolledBack ? { promotionRolledBack: true } : {})
  };
}
