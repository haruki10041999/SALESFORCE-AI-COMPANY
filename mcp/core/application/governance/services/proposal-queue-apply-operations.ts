import {
  type ProposalResourceType,
  type ProposalRecord,
  type ProposalStatus,
  type ApprovalStage
} from "../../../resource/proposal/queue.js";
import { type ProposalQueueStore } from "../../../resource/proposal/proposal-queue-store.js";
import { applyProposal } from "../../../resource/proposal/applier.js";
import {
  evaluateAutoCreateGate,
  countTodayApplied,
  DEFAULT_AUTO_CREATE_CONFIG,
  type AutoCreateConfig,
  type AutoCreatePolicy
} from "../../../resource/proposal/auto-create-gate.js";

export interface ProposalApprovalAudit {
  event: string;
  proposalId: string;
  actor: string;
  status: string;
  stage?: string;
  applied?: boolean;
  applyError?: string;
  reason?: string;
  [key: string]: unknown;
}

export async function executeEnqueueProposal(args: {
  resourceType: ProposalResourceType;
  name: string;
  content: string;
  confidence?: number;
  sourceEvent?: string;
  origin?: string;
  proposalQueue: ProposalQueueStore;
  createdByActorId?: string;
}): Promise<Record<string, unknown>> {
  const record = await args.proposalQueue.enqueue({
    resourceType: args.resourceType,
    name: args.name,
    content: args.content,
    confidence: args.confidence,
    sourceEvent: args.sourceEvent,
    origin: args.origin,
    createdByActorId: args.createdByActorId
  });
  return { enqueued: record };
}

export async function executeListProposals(args: {
  status?: ProposalStatus;
  resourceType?: ProposalResourceType;
  limit?: number;
  proposalQueue: ProposalQueueStore;
  historyAcceptRateByResource?: Record<string, number>;
}): Promise<Record<string, unknown>> {
  const items = await args.proposalQueue.list({
    status: args.status,
    resourceType: args.resourceType,
    limit: args.limit,
    historyAcceptRateByResource: args.historyAcceptRateByResource
  });
  const summary = await args.proposalQueue.summarize();
  return { summary, items };
}

export async function executeGetProposal(args: {
  id: string;
  proposalQueue: ProposalQueueStore;
}): Promise<Record<string, unknown>> {
  const record = await args.proposalQueue.get(args.id);
  return {
    found: record !== null,
    record
  };
}

export async function executeApproveProposalStage(args: {
  id: string;
  stage: ApprovalStage;
  actor: string;
  comment?: string;
  proposalQueue: ProposalQueueStore;
  appendApprovalAudit: (event: ProposalApprovalAudit) => Promise<void>;
  approvalAuditFile: string;
}): Promise<Record<string, unknown>> {
  const record = await args.proposalQueue.approveStage(args.id, {
    stage: args.stage,
    actor: args.actor,
    comment: args.comment
  });
  await args.appendApprovalAudit({
    event: "proposal_stage_approved",
    proposalId: args.id,
    stage: args.stage,
    actor: args.actor,
    status: record.status
  });
  return {
    approved: true,
    stage: args.stage,
    actor: args.actor,
    record,
    auditFile: args.approvalAuditFile
  };
}

export async function executeRejectProposalStage(args: {
  id: string;
  stage: ApprovalStage;
  actor: string;
  reason: string;
  proposalQueue: ProposalQueueStore;
  appendApprovalAudit: (event: ProposalApprovalAudit) => Promise<void>;
  approvalAuditFile: string;
}): Promise<Record<string, unknown>> {
  const record = await args.proposalQueue.rejectStage(args.id, {
    stage: args.stage,
    actor: args.actor,
    reason: args.reason
  });
  await args.appendApprovalAudit({
    event: "proposal_stage_rejected",
    proposalId: args.id,
    stage: args.stage,
    actor: args.actor,
    status: record.status,
    reason: args.reason
  });
  return {
    rejected: true,
    stage: args.stage,
    actor: args.actor,
    record,
    auditFile: args.approvalAuditFile
  };
}

export async function executeRejectProposal(args: {
  id: string;
  reason: string;
  proposalQueue: ProposalQueueStore;
  appendApprovalAudit: (event: ProposalApprovalAudit) => Promise<void>;
}): Promise<Record<string, unknown>> {
  const record = await args.proposalQueue.reject(args.id, args.reason);
  await args.appendApprovalAudit({
    event: "proposal_rejected",
    proposalId: args.id,
    actor: "system",
    status: record.status,
    reason: args.reason
  });
  return { rejected: record };
}

export async function executeApproveProposal(args: {
  id: string;
  apply?: boolean;
  overwrite?: boolean;
  repoRoot: string;
  outputsDir: string;
  proposalQueue: ProposalQueueStore;
  appendApprovalAudit: (event: ProposalApprovalAudit) => Promise<void>;
}): Promise<Record<string, unknown>> {
  const pending = await args.proposalQueue.get(args.id);
  if (!pending) {
    return { ok: false, error: `proposal not found: ${args.id}` };
  }
  if (pending.status !== "pending") {
    return { ok: false, error: `proposal status is ${pending.status}; only pending can be approved` };
  }

  const shouldApply = args.apply !== false;
  let applyResult: ReturnType<typeof applyProposal> | undefined;
  let applyError: string | undefined;

  if (shouldApply) {
    try {
      applyResult = applyProposal(pending, {
        repoRoot: args.repoRoot,
        outputsDir: args.outputsDir,
        overwrite: args.overwrite === true
      });
    } catch (error) {
      applyError = error instanceof Error ? error.message : String(error);
    }
  }

  const record = await args.proposalQueue.approve(args.id);
  await args.appendApprovalAudit({
    event: "proposal_approved",
    proposalId: args.id,
    actor: "system",
    status: record.status,
    applied: shouldApply,
    ...(applyError !== undefined ? { applyError } : {})
  });

  return {
    ok: true,
    approved: record,
    applied: shouldApply,
    ...(applyResult !== undefined ? { applyResult } : {}),
    ...(applyError !== undefined ? { applyError } : {})
  };
}

export async function executeApplyProposal(args: {
  id: string;
  overwrite?: boolean;
  repoRoot: string;
  outputsDir: string;
  proposalQueue: ProposalQueueStore;
}): Promise<Record<string, unknown>> {
  const record = await args.proposalQueue.get(args.id);
  if (!record) {
    return { ok: false, error: `proposal not found: ${args.id}` };
  }
  if (record.status !== "pending") {
    return { ok: false, error: `proposal status is ${record.status}; only pending can be applied` };
  }

  const applyResult = applyProposal(record, {
    repoRoot: args.repoRoot,
    outputsDir: args.outputsDir,
    overwrite: args.overwrite === true
  });
  const moved = applyResult.applied ? await args.proposalQueue.approve(args.id) : record;
  return { ok: applyResult.applied, applyResult, record: moved };
}

export async function executeAutoApplyPendingProposals(args: {
  config?: Partial<Record<ProposalResourceType, AutoCreatePolicy>>;
  denyList?: Array<{ resourceType: ProposalResourceType; name: string }>;
  dryRun?: boolean;
  overwrite?: boolean;
  limit?: number;
  repoRoot: string;
  outputsDir: string;
  proposalQueue: ProposalQueueStore;
}): Promise<Record<string, unknown>> {
  const merged: AutoCreateConfig = {
    skills: { ...DEFAULT_AUTO_CREATE_CONFIG.skills, ...(args.config?.skills ?? {}) },
    tools: { ...DEFAULT_AUTO_CREATE_CONFIG.tools, ...(args.config?.tools ?? {}) },
    presets: { ...DEFAULT_AUTO_CREATE_CONFIG.presets, ...(args.config?.presets ?? {}) }
  };

  const approvedHistory = await args.proposalQueue.list({ status: "approved" });
  const todayAppliedCount = countTodayApplied(approvedHistory);
  const pending = await args.proposalQueue.list({ status: "pending", limit: args.limit ?? 50 });

  const decisions: Array<{
    id: string;
    resourceType: ProposalResourceType;
    name: string;
    confidence: number;
    allow: boolean;
    reasonCode?: string;
    reason?: string;
    applied?: boolean;
    filePath?: string;
  }> = [];

  let appliedCount = 0;
  for (const proposal of pending) {
    const decision = evaluateAutoCreateGate({
      proposal,
      config: merged,
      todayAppliedCount,
      denyList: args.denyList
    });
    const entry: (typeof decisions)[number] = {
      id: proposal.id,
      resourceType: proposal.resourceType,
      name: proposal.name,
      confidence: proposal.confidence,
      allow: decision.allow,
      reasonCode: decision.reasonCode,
      reason: decision.reason
    };

    if (decision.allow) {
      if (args.dryRun === true) {
        entry.applied = false;
        entry.reason = "dry-run";
      } else {
        const result = applyProposal(proposal, {
          repoRoot: args.repoRoot,
          outputsDir: args.outputsDir,
          overwrite: args.overwrite === true
        });
        entry.applied = result.applied;
        entry.filePath = result.filePath;
        if (result.applied) {
          await args.proposalQueue.approve(proposal.id);
          todayAppliedCount[proposal.resourceType] = (todayAppliedCount[proposal.resourceType] ?? 0) + 1;
          appliedCount += 1;
        } else {
          entry.reason = result.reason;
        }
      }
    }
    decisions.push(entry);
  }

  return {
    dryRun: args.dryRun === true,
    scanned: pending.length,
    applied: appliedCount,
    todayAppliedCountAfter: todayAppliedCount,
    decisions
  };
}
