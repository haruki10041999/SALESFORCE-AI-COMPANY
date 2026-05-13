import { z } from "zod";
import type { RegisterGovToolDeps } from "./types.js";
import type { ProposalQueueStore } from "../core/resource/proposal/proposal-queue-store.js";
import { PostgresEventStore } from "../core/persistence/postgres-event-store.js";
import { runLearningPromotionWorkflow } from "../core/orchestration/workflows/learning-promotion.workflow.js";
import { DEFAULT_ARBITRATION_POLICY } from "../core/learning/model-arbitration.js";
import { DEFAULT_PROMOTION_POLICY } from "../core/learning/model-registry.js";

const evaluationStatsSchema = z.object({
  shadowVersion: z.string(),
  productionVersion: z.string(),
  total: z.number(),
  shadowWins: z.number(),
  productionWins: z.number(),
  ties: z.number(),
  signedDelta: z.number(),
  shadowWinRate: z.number()
});

const registrySnapshotSchema = z.object({
  models: z.array(
    z.object({
      name: z.string(),
      productionVersion: z.string(),
      versionList: z.array(z.string()),
      shadowVersions: z.array(z.string()),
      history: z.array(z.string()),
      evaluations: z.array(evaluationStatsSchema)
    })
  )
});

export interface RegisterLearningToolsDeps extends RegisterGovToolDeps {
  proposalQueue: ProposalQueueStore;
  databaseUrl?: string;
}

export function registerLearningTools(deps: RegisterLearningToolsDeps): void {
  const { govTool, proposalQueue, databaseUrl } = deps;

  govTool(
    "learning_orchestrator",
    {
      title: "Learning Orchestrator",
      description: "shadow -> canary -> promote / rollback の判断を実行し、必要なら proposal queue と event store に記録します。",
      inputSchema: {
        registrySnapshot: registrySnapshotSchema,
        modelName: z.string(),
        currentCanaryVersion: z.string().optional(),
        canaryTrafficPercent: z.number().int().min(1).max(100).optional(),
        manualApprovalRequired: z.boolean().optional(),
        manualOverride: z.enum(["approve", "reject"]).optional(),
        actorId: z.string().optional(),
        dryRun: z.boolean().optional(),
        driftReport: z.object({
          shouldAlert: z.boolean(),
          alerts: z.array(z.string()).optional()
        }).optional(),
        policy: z.object({
          minSamples: z.number().int().min(1).optional(),
          minShadowWinRate: z.number().min(0).max(1).optional(),
          minSignedDelta: z.number().min(0).max(1).optional()
        }).optional(),
        arbitrationPolicy: z.object({
          minCoverage: z.number().int().min(1).optional(),
          minConfidence: z.number().min(0).max(1).optional(),
          recencyAdvantageMs: z.number().int().min(0).optional()
        }).optional()
      }
    },
    async (input: {
      registrySnapshot: z.infer<typeof registrySnapshotSchema>;
      modelName: string;
      currentCanaryVersion?: string;
      canaryTrafficPercent?: number;
      manualApprovalRequired?: boolean;
      manualOverride?: "approve" | "reject";
      actorId?: string;
      dryRun?: boolean;
      driftReport?: { shouldAlert: boolean; alerts?: string[] };
      policy?: { minSamples?: number; minShadowWinRate?: number; minSignedDelta?: number };
      arbitrationPolicy?: { minCoverage?: number; minConfidence?: number; recencyAdvantageMs?: number };
    }) => {
      const useSideEffects = input.dryRun !== true;
      const eventStore = useSideEffects && databaseUrl ? await PostgresEventStore.open({ databaseUrl }) : undefined;
      const policy = input.policy
        ? {
            minSamples: input.policy.minSamples ?? DEFAULT_PROMOTION_POLICY.minSamples,
            minShadowWinRate: input.policy.minShadowWinRate ?? DEFAULT_PROMOTION_POLICY.minShadowWinRate,
            minSignedDelta: input.policy.minSignedDelta ?? DEFAULT_PROMOTION_POLICY.minSignedDelta
          }
        : undefined;
      const arbitrationPolicy = input.arbitrationPolicy
        ? {
            minCoverage: input.arbitrationPolicy.minCoverage ?? DEFAULT_ARBITRATION_POLICY.minCoverage,
            minConfidence: input.arbitrationPolicy.minConfidence ?? DEFAULT_ARBITRATION_POLICY.minConfidence,
            recencyAdvantageMs:
              input.arbitrationPolicy.recencyAdvantageMs ?? DEFAULT_ARBITRATION_POLICY.recencyAdvantageMs
          }
        : undefined;
      try {
        const result = await runLearningPromotionWorkflow(
          {
            registrySnapshot: input.registrySnapshot,
            modelName: input.modelName,
            currentCanaryVersion: input.currentCanaryVersion,
            canaryTrafficPercent: input.canaryTrafficPercent,
            manualApprovalRequired: input.manualApprovalRequired,
            manualOverride: input.manualOverride,
            actorId: input.actorId,
            driftReport: input.driftReport,
            policy,
            arbitrationPolicy
          },
          {
            eventStore,
            queueProposal: useSideEffects
              ? async (proposalInput) => proposalQueue.enqueue(proposalInput)
              : undefined
          }
        );

        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
        };
      } finally {
        await eventStore?.close();
      }
    }
  );
}
