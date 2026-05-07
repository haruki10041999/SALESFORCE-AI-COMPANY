import {
  approveProposal,
  approveProposalStage,
  buildProposal,
  computeProposalPriority,
  enqueueProposal,
  getProposal,
  listProposals,
  rejectProposal,
  rejectProposalStage,
  summarizeProposalQueue,
  type ApprovalStage,
  type ListProposalsOptions,
  type NewProposalInput,
  type ProposalQueueSummary,
  type ProposalRecord
} from "./queue.js";
import { PgBossProposalQueueStore } from "./pg-boss-proposal-queue.js";

export type { ApprovalStage, ListProposalsOptions, NewProposalInput, ProposalQueueSummary, ProposalRecord };
export { buildProposal, computeProposalPriority };

export interface ProposalQueueStore {
  enqueue(input: NewProposalInput, now?: Date): Promise<ProposalRecord>;
  list(options?: ListProposalsOptions): Promise<ProposalRecord[]>;
  get(id: string): Promise<ProposalRecord | null>;
  approve(id: string): Promise<ProposalRecord>;
  reject(id: string, reason: string): Promise<ProposalRecord>;
  approveStage(id: string, input: { stage: ApprovalStage; actor: string; comment?: string }): Promise<ProposalRecord>;
  rejectStage(id: string, input: { stage: ApprovalStage; actor: string; reason: string }): Promise<ProposalRecord>;
  summarize(): Promise<ProposalQueueSummary>;
  scheduleRecurringJob?(input: { queue: string; cron: string; data?: Record<string, unknown>; key?: string }): Promise<void>;
  unscheduleRecurringJob?(input: { queue: string; key?: string }): Promise<void>;
  close?(): Promise<void>;
}

export function createFileProposalQueueStore(outputsDir: string): ProposalQueueStore {
  return {
    enqueue: async (input, now) => enqueueProposal(outputsDir, input, now),
    list: async (options) => listProposals(outputsDir, options),
    get: async (id) => getProposal(outputsDir, id),
    approve: async (id) => approveProposal(outputsDir, id),
    reject: async (id, reason) => rejectProposal(outputsDir, id, reason),
    approveStage: async (id, input) => approveProposalStage(outputsDir, id, input),
    rejectStage: async (id, input) => rejectProposalStage(outputsDir, id, input),
    summarize: async () => summarizeProposalQueue(outputsDir)
  };
}

export type ProposalQueueBackend = "file" | "pg-boss";

export function resolveProposalQueueBackend(value: string | undefined, stateBackend?: string): ProposalQueueBackend {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "file" || normalized === "pg-boss") {
    return normalized;
  }
  return stateBackend === "postgres" ? "pg-boss" : "file";
}

export async function createProposalQueueStore(options: {
  backend: ProposalQueueBackend;
  outputsDir: string;
  databaseUrl?: string;
}): Promise<ProposalQueueStore> {
  if (options.backend === "pg-boss") {
    if (!options.databaseUrl || options.databaseUrl.trim().length === 0) {
      throw new Error("DATABASE_URL is required when SF_AI_PROPOSAL_QUEUE_BACKEND=pg-boss");
    }
    return PgBossProposalQueueStore.open({ databaseUrl: options.databaseUrl });
  }
  return createFileProposalQueueStore(options.outputsDir);
}