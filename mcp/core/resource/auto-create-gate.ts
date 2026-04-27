/**
 * Phase 3: Auto-create gate.
 *
 * 保留中の ProposalRecord を自動承認＋適用してよいかを判定する純粋関数。
 *
 * 設計方針:
 *   - 既定は **すべての resourceType で OFF** (明示的 opt-in)
 *   - 判定ロジックは pure。I/O は外側 (apply_proposal などのハンドラ層) で実行する。
 *   - 拒否理由は文字列で返し、上位レイヤーで監査ログ／system event に渡せるようにする。
 *
 * Gate の構成:
 *   1. resourceType ごとに enabled フラグ
 *   2. confidence threshold (record.confidence >= threshold)
 *   3. 当日適用済み件数 < maxPerDay
 *   4. 任意の denyList (resourceType + name 完全一致で拒否)
 */

import type { ProposalRecord, ProposalResourceType } from "./proposal-queue.js";

export interface AutoCreatePolicy {
  enabled: boolean;
  /** 0..1。record.confidence がこれ以上で許可。 */
  threshold: number;
  /** 同 resourceType の今日の自動適用上限。 */
  maxPerDay: number;
}

export type AutoCreateConfig = Record<ProposalResourceType, AutoCreatePolicy>;

export const DEFAULT_AUTO_CREATE_CONFIG: AutoCreateConfig = {
  skills:  { enabled: false, threshold: 0.85, maxPerDay: 2 },
  tools:   { enabled: false, threshold: 0.90, maxPerDay: 1 },
  presets: { enabled: false, threshold: 0.75, maxPerDay: 3 }
};

export interface AutoCreateGateInput {
  proposal: ProposalRecord;
  config: AutoCreateConfig;
  /** 同日 resourceType ごとに、すでに自動適用された件数。 */
  todayAppliedCount: Record<ProposalResourceType, number>;
  /** denyList (resourceType:name で完全一致を弾く) */
  denyList?: ReadonlyArray<{ resourceType: ProposalResourceType; name: string }>;
}

export interface AutoCreateGateDecision {
  allow: boolean;
  /** denied 時の機械可読な理由コード */
  reasonCode?:
    | "type-disabled"
    | "below-threshold"
    | "daily-limit-reached"
    | "denied-by-list"
    | "not-pending";
  /** 人向けメッセージ */
  reason?: string;
}

export function evaluateAutoCreateGate(input: AutoCreateGateInput): AutoCreateGateDecision {
  const { proposal, config, todayAppliedCount, denyList = [] } = input;

  if (proposal.status !== "pending") {
    return { allow: false, reasonCode: "not-pending", reason: `proposal status is ${proposal.status}` };
  }

  const policy = config[proposal.resourceType];
  if (!policy || !policy.enabled) {
    return {
      allow: false,
      reasonCode: "type-disabled",
      reason: `auto-create is disabled for resourceType=${proposal.resourceType}`
    };
  }

  if (proposal.confidence < policy.threshold) {
    return {
      allow: false,
      reasonCode: "below-threshold",
      reason: `confidence ${proposal.confidence.toFixed(2)} < threshold ${policy.threshold.toFixed(2)}`
    };
  }

  const denied = denyList.some(
    (entry) => entry.resourceType === proposal.resourceType && entry.name === proposal.name
  );
  if (denied) {
    return {
      allow: false,
      reasonCode: "denied-by-list",
      reason: `${proposal.resourceType}:${proposal.name} is on denyList`
    };
  }

  const usedToday = todayAppliedCount[proposal.resourceType] ?? 0;
  if (usedToday >= policy.maxPerDay) {
    return {
      allow: false,
      reasonCode: "daily-limit-reached",
      reason: `today applied count ${usedToday} >= maxPerDay ${policy.maxPerDay} for ${proposal.resourceType}`
    };
  }

  return { allow: true };
}

/**
 * approved/ ディレクトリ内の resolvedAt を集計し、本日 (UTC 00:00 起点) の
 * resourceType 別の適用件数を返す純粋関数。
 */
export function countTodayApplied(
  approvedRecords: ReadonlyArray<ProposalRecord>,
  now: Date = new Date()
): Record<ProposalResourceType, number> {
  const todayKey = now.toISOString().slice(0, 10);
  const result: Record<ProposalResourceType, number> = { skills: 0, tools: 0, presets: 0 };
  for (const r of approvedRecords) {
    if (!r.resolvedAt) continue;
    if (!r.resolvedAt.startsWith(todayKey)) continue;
    if (r.status !== "approved") continue;
    result[r.resourceType] = (result[r.resourceType] ?? 0) + 1;
  }
  return result;
}
