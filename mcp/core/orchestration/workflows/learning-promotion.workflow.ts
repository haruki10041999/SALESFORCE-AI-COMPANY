import type { EventStore } from "../../ports/event-store.js";
import type { ArbitrationPolicy } from "../../learning/model-arbitration.js";
import {
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
  queueProposal?: (input: NewProposalInput) => Promise<ProposalRecord>;
}

export async function runLearningPromotionWorkflow(
  input: LearningPromotionWorkflowInput,
  deps: LearningPromotionWorkflowDeps = {}
): Promise<LearningOrchestratorResult> {
  const registry = restoreRegistryFromSnapshot(input.registrySnapshot);
  const driftReport = input.driftReport
    ? {
        shouldAlert: input.driftReport.shouldAlert,
        ...(input.driftReport.alerts ? { alerts: input.driftReport.alerts } : {})
      }
    : undefined;
  return runLearningOrchestrator(
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
}
