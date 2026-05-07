/**
 * Phase 1: Proposal Queue (resource creation proposals).
 *
 * リソース不足検知 (`resource_gap_detected` 等) や手動の事前提案を
 * **永続化** することで、人間が後でまとめて確認・承認できるようにする。
 *
 * ストレージ:
 *   outputs/tool-proposals/pending/<id>.json    ← 未処理
 *   outputs/tool-proposals/approved/<id>.json   ← 承認・適用済 (audit 用)
 *   outputs/tool-proposals/rejected/<id>.json   ← 却下 (audit 用)
 *
 * 純粋関数 (`buildProposal`, `nextProposalId`) と I/O 関数を分離し、
 * テスト容易性を確保する。
 *
 * NOTE: 自動適用 (auto-apply gate) は Phase 3 以降。Phase 1 では
 * "永続化 + 手動 approve/reject" のみを提供する。
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type ProposalStatus = "pending" | "approved" | "rejected";
export type ApprovalStage = "reviewer" | "admin";
export type ProposalApprovalDecision = "approved" | "rejected";

export type ProposalResourceType = "skills" | "tools" | "presets";

export interface ProposalApprovalAction {
  stage: ApprovalStage;
  actor: string;
  decision: ProposalApprovalDecision;
  decidedAt: string;
  comment?: string;
}

export interface ProposalApprovalState {
  requiredStages: ApprovalStage[];
  currentStage: ApprovalStage;
  completedStages: ApprovalStage[];
  history: ProposalApprovalAction[];
  finalApprovedAt?: string;
  rejectedAt?: string;
}

export interface ProposalRecord {
  /** 安定ソート可能な ID。`prop-<unix-ms>-<rand>` 形式。 */
  id: string;
  resourceType: ProposalResourceType;
  /** 作成対象リソース名 (slug 化前) */
  name: string;
  /** Markdown / JSON / 説明文 */
  content: string;
  /** 0..1 の自動信頼度。手動 enqueue は 0 とする。 */
  confidence: number;
  /** 提案を出した契機となるイベント名 (例: "resource_gap_detected") */
  sourceEvent?: string;
  /** suggester / detector など、提案発生元のラベル */
  origin?: string;
  /** 提案作成 ISO timestamp */
  createdAt: string;
  /** 承認/却下 ISO timestamp */
  resolvedAt?: string;
  /** 却下理由 (rejected の場合のみ) */
  rejectReason?: string;
  /** F12: multi-stage approval 状態 */
  approval?: ProposalApprovalState;
  /** T3-1: queue ordering priority snapshot */
  priorityScore?: number;
  /** T3-1: priority components */
  priorityBreakdown?: {
    topicRelevance: number;
    historyAcceptRate: number;
    stalenessPenalty: number;
  };
  status: ProposalStatus;
}

export interface ProposalPriority {
  score: number;
  topicRelevance: number;
  historyAcceptRate: number;
  stalenessPenalty: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function computeProposalPriority(
  record: ProposalRecord,
  options: {
    now?: Date;
    historyAcceptRate?: number;
    topicRelevance?: number;
  } = {}
): ProposalPriority {
  const nowMs = (options.now ?? new Date()).getTime();
  const createdAtMs = Number.isFinite(Date.parse(record.createdAt))
    ? Date.parse(record.createdAt)
    : nowMs;
  const ageDays = Math.max(0, (nowMs - createdAtMs) / (24 * 60 * 60 * 1000));
  const stalenessPenalty = clamp(ageDays / 30, 0, 1);
  const topicRelevance = clamp(
    typeof options.topicRelevance === "number" ? options.topicRelevance : record.confidence,
    0,
    1
  );
  const historyAcceptRate = clamp(options.historyAcceptRate ?? 0.5, 0, 1);
  const score = topicRelevance * historyAcceptRate - stalenessPenalty;
  return { score, topicRelevance, historyAcceptRate, stalenessPenalty };
}

export interface NewProposalInput {
  resourceType: ProposalResourceType;
  name: string;
  content: string;
  confidence?: number;
  sourceEvent?: string;
  origin?: string;
  requiredApprovalStages?: ApprovalStage[];
}

const PROPOSAL_ID_PREFIX = "prop";

/**
 * 衝突しにくい proposal ID を生成する純粋関数。
 * `now` を引数に取ることでテスト可能にしている。
 */
export function nextProposalId(now: number, rand: () => number = Math.random): string {
  const tail = Math.floor(rand() * 1_000_000).toString(36).padStart(4, "0");
  return `${PROPOSAL_ID_PREFIX}-${now.toString(36)}-${tail}`;
}

/**
 * NewProposalInput を ProposalRecord に正規化する純粋関数。
 *
 * - `confidence` は 0..1 にクランプ
 * - `name` は trim
 * - `status` は常に "pending"
 */
export function buildProposal(input: NewProposalInput, now: Date, id: string): ProposalRecord {
  const confidence = clamp01(typeof input.confidence === "number" ? input.confidence : 0);
  const name = input.name.trim();
  if (name.length === 0) {
    throw new Error("proposal name must not be empty");
  }
  if (input.content.trim().length === 0) {
    throw new Error("proposal content must not be empty");
  }
  const requiredStages = normalizeApprovalStages(input.requiredApprovalStages);
  return {
    id,
    resourceType: input.resourceType,
    name,
    content: input.content,
    confidence,
    sourceEvent: input.sourceEvent,
    origin: input.origin,
    approval: {
      requiredStages,
      currentStage: requiredStages[0],
      completedStages: [],
      history: []
    },
    createdAt: now.toISOString(),
    status: "pending"
  };
}

function normalizeApprovalStages(stages?: ApprovalStage[]): ApprovalStage[] {
  const defaults: ApprovalStage[] = ["reviewer", "admin"];
  if (!Array.isArray(stages) || stages.length === 0) {
    return defaults;
  }
  const normalized = [...new Set(stages)];
  const filtered = normalized.filter((stage): stage is ApprovalStage => stage === "reviewer" || stage === "admin");
  return filtered.length > 0 ? filtered : defaults;
}

function ensureApprovalState(record: ProposalRecord): ProposalApprovalState {
  if (record.approval) return record.approval;
  const requiredStages = normalizeApprovalStages();
  return {
    requiredStages,
    currentStage: requiredStages[0],
    completedStages: [],
    history: []
  };
}

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

// ===== I/O =====

export interface ProposalQueuePaths {
  pendingDir: string;
  approvedDir: string;
  rejectedDir: string;
}

export function resolveProposalQueuePaths(outputsDir: string): ProposalQueuePaths {
  const root = join(outputsDir, "tool-proposals");
  return {
    pendingDir: join(root, "pending"),
    approvedDir: join(root, "approved"),
    rejectedDir: join(root, "rejected")
  };
}

function ensureDirs(paths: ProposalQueuePaths): void {
  for (const dir of [paths.pendingDir, paths.approvedDir, paths.rejectedDir]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}

function proposalFilePath(dir: string, id: string): string {
  return join(dir, `${id}.json`);
}

export function enqueueProposal(
  outputsDir: string,
  input: NewProposalInput,
  now: Date = new Date()
): ProposalRecord {
  const paths = resolveProposalQueuePaths(outputsDir);
  ensureDirs(paths);
  const id = nextProposalId(now.getTime());
  const record = buildProposal(input, now, id);
  writeFileSync(proposalFilePath(paths.pendingDir, id), JSON.stringify(record, null, 2), "utf-8");
  return record;
}

function updatePendingProposal(
  outputsDir: string,
  id: string,
  patch: Partial<ProposalRecord>
): ProposalRecord {
  const paths = resolveProposalQueuePaths(outputsDir);
  ensureDirs(paths);
  const fp = proposalFilePath(paths.pendingDir, id);
  if (!existsSync(fp)) {
    throw new Error(`proposal not found in pending: ${id}`);
  }
  const current = JSON.parse(readFileSync(fp, "utf-8")) as ProposalRecord;
  const next: ProposalRecord = {
    ...current,
    ...patch
  };
  writeFileSync(fp, JSON.stringify(next, null, 2), "utf-8");
  return next;
}

function readDirRecords(dir: string): ProposalRecord[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      try {
        const raw = readFileSync(join(dir, name), "utf-8");
        return JSON.parse(raw) as ProposalRecord;
      } catch {
        return null;
      }
    })
    .filter((r): r is ProposalRecord => r !== null);
}

export interface ListProposalsOptions {
  status?: ProposalStatus;
  resourceType?: ProposalResourceType;
  limit?: number;
  now?: Date;
  historyAcceptRateByResource?: Record<string, number>;
}

export function listProposals(outputsDir: string, options: ListProposalsOptions = {}): ProposalRecord[] {
  const paths = resolveProposalQueuePaths(outputsDir);
  const dirs: Array<{ status: ProposalStatus; dir: string }> = [];
  if (!options.status || options.status === "pending") dirs.push({ status: "pending", dir: paths.pendingDir });
  if (!options.status || options.status === "approved") dirs.push({ status: "approved", dir: paths.approvedDir });
  if (!options.status || options.status === "rejected") dirs.push({ status: "rejected", dir: paths.rejectedDir });

  let records = dirs.flatMap(({ dir }) => readDirRecords(dir));
  if (options.resourceType) {
    records = records.filter((r) => r.resourceType === options.resourceType);
  }
  const now = options.now ?? new Date();
  const rates = options.historyAcceptRateByResource ?? {};
  records = records.map((record) => {
    const rate = rates[`${record.resourceType}:${record.name}`];
    const priority = computeProposalPriority(record, { now, historyAcceptRate: rate });
    return {
      ...record,
      priorityScore: Number(priority.score.toFixed(6)),
      priorityBreakdown: {
        topicRelevance: Number(priority.topicRelevance.toFixed(6)),
        historyAcceptRate: Number(priority.historyAcceptRate.toFixed(6)),
        stalenessPenalty: Number(priority.stalenessPenalty.toFixed(6))
      }
    };
  });
  records.sort((a, b) => {
    const aPriority = a.priorityScore ?? Number.NEGATIVE_INFINITY;
    const bPriority = b.priorityScore ?? Number.NEGATIVE_INFINITY;
    if (bPriority !== aPriority) return bPriority - aPriority;
    return b.createdAt.localeCompare(a.createdAt);
  });
  if (typeof options.limit === "number" && options.limit > 0) {
    records = records.slice(0, options.limit);
  }
  return records;
}

export function getProposal(outputsDir: string, id: string): ProposalRecord | null {
  const paths = resolveProposalQueuePaths(outputsDir);
  for (const dir of [paths.pendingDir, paths.approvedDir, paths.rejectedDir]) {
    const fp = proposalFilePath(dir, id);
    if (existsSync(fp)) {
      try { return JSON.parse(readFileSync(fp, "utf-8")) as ProposalRecord; } catch { return null; }
    }
  }
  return null;
}

function moveProposal(
  outputsDir: string,
  id: string,
  to: "approved" | "rejected",
  patch: Partial<ProposalRecord>
): ProposalRecord {
  const paths = resolveProposalQueuePaths(outputsDir);
  ensureDirs(paths);
  const fromPath = proposalFilePath(paths.pendingDir, id);
  if (!existsSync(fromPath)) {
    throw new Error(`proposal not found in pending: ${id}`);
  }
  const current = JSON.parse(readFileSync(fromPath, "utf-8")) as ProposalRecord;
  const next: ProposalRecord = {
    ...current,
    ...patch,
    status: to,
    resolvedAt: new Date().toISOString()
  };
  const targetDir = to === "approved" ? paths.approvedDir : paths.rejectedDir;
  const toPath = proposalFilePath(targetDir, id);
  writeFileSync(toPath, JSON.stringify(next, null, 2), "utf-8");
  if (existsSync(fromPath)) {
    try { unlinkSync(fromPath); } catch { /* noop */ }
  }
  return next;
}

export function approveProposal(outputsDir: string, id: string): ProposalRecord {
  const current = getProposal(outputsDir, id);
  const approval = current ? ensureApprovalState(current) : undefined;
  const now = new Date().toISOString();
  const history: ProposalApprovalAction[] = approval
    ? [
        ...approval.history,
        {
          stage: approval.currentStage,
          actor: "system",
          decision: "approved" as const,
          decidedAt: now,
          comment: "legacy direct approval"
        }
      ]
    : [];

  return moveProposal(outputsDir, id, "approved", {
    approval: approval
      ? {
          ...approval,
          completedStages: [...new Set([...approval.completedStages, ...approval.requiredStages])],
          currentStage: approval.requiredStages[approval.requiredStages.length - 1] ?? "admin",
          history,
          finalApprovedAt: now
        }
      : undefined
  });
}

export function rejectProposal(outputsDir: string, id: string, reason: string): ProposalRecord {
  const trimmed = reason.trim();
  if (trimmed.length === 0) {
    throw new Error("rejectReason must not be empty");
  }
  const current = getProposal(outputsDir, id);
  const approval = current ? ensureApprovalState(current) : undefined;
  const now = new Date().toISOString();
  const history: ProposalApprovalAction[] = approval
    ? [
        ...approval.history,
        {
          stage: approval.currentStage,
          actor: "system",
          decision: "rejected" as const,
          decidedAt: now,
          comment: trimmed
        }
      ]
    : [];
  return moveProposal(outputsDir, id, "rejected", {
    rejectReason: trimmed,
    approval: approval
      ? {
          ...approval,
          history,
          rejectedAt: now
        }
      : undefined
  });
}

export function approveProposalStage(
  outputsDir: string,
  id: string,
  input: { stage: ApprovalStage; actor: string; comment?: string }
): ProposalRecord {
  const current = getProposal(outputsDir, id);
  if (!current || current.status !== "pending") {
    throw new Error(`proposal not found in pending: ${id}`);
  }
  const approval = ensureApprovalState(current);
  if (approval.currentStage !== input.stage) {
    throw new Error(`current stage is ${approval.currentStage}; requested ${input.stage}`);
  }

  const now = new Date().toISOString();
  const completedStages = [...new Set([...approval.completedStages, input.stage])];
  const history: ProposalApprovalAction[] = [
    ...approval.history,
    {
      stage: input.stage,
      actor: input.actor,
      decision: "approved",
      decidedAt: now,
      comment: input.comment
    }
  ];

  const requiredStages = normalizeApprovalStages(approval.requiredStages);
  const currentIdx = requiredStages.indexOf(input.stage);
  const nextStage = requiredStages[currentIdx + 1];

  if (!nextStage) {
    return moveProposal(outputsDir, id, "approved", {
      approval: {
        ...approval,
        requiredStages,
        completedStages,
        history,
        finalApprovedAt: now
      }
    });
  }

  return updatePendingProposal(outputsDir, id, {
    approval: {
      ...approval,
      requiredStages,
      completedStages,
      currentStage: nextStage,
      history
    }
  });
}

export function rejectProposalStage(
  outputsDir: string,
  id: string,
  input: { stage: ApprovalStage; actor: string; reason: string }
): ProposalRecord {
  const current = getProposal(outputsDir, id);
  if (!current || current.status !== "pending") {
    throw new Error(`proposal not found in pending: ${id}`);
  }
  const approval = ensureApprovalState(current);
  if (approval.currentStage !== input.stage) {
    throw new Error(`current stage is ${approval.currentStage}; requested ${input.stage}`);
  }
  const trimmed = input.reason.trim();
  if (trimmed.length === 0) {
    throw new Error("rejectReason must not be empty");
  }
  const now = new Date().toISOString();
  const history: ProposalApprovalAction[] = [
    ...approval.history,
    {
      stage: input.stage,
      actor: input.actor,
      decision: "rejected",
      decidedAt: now,
      comment: trimmed
    }
  ];

  return moveProposal(outputsDir, id, "rejected", {
    rejectReason: trimmed,
    approval: {
      ...approval,
      history,
      rejectedAt: now
    }
  });
}

export interface ProposalQueueSummary {
  pending: number;
  approved: number;
  rejected: number;
  byResourceType: Record<ProposalResourceType, { pending: number; approved: number; rejected: number }>;
}

export function summarizeProposalQueue(outputsDir: string): ProposalQueueSummary {
  const paths = resolveProposalQueuePaths(outputsDir);
  const pending = readDirRecords(paths.pendingDir);
  const approved = readDirRecords(paths.approvedDir);
  const rejected = readDirRecords(paths.rejectedDir);
  const summary: ProposalQueueSummary = {
    pending: pending.length,
    approved: approved.length,
    rejected: rejected.length,
    byResourceType: {
      skills: { pending: 0, approved: 0, rejected: 0 },
      tools: { pending: 0, approved: 0, rejected: 0 },
      presets: { pending: 0, approved: 0, rejected: 0 }
    }
  };
  for (const r of pending) summary.byResourceType[r.resourceType].pending += 1;
  for (const r of approved) summary.byResourceType[r.resourceType].approved += 1;
  for (const r of rejected) summary.byResourceType[r.resourceType].rejected += 1;
  return summary;
}
