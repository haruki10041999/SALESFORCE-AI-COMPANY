/**
 * A16: Feedback Loop 可視化
 *
 * `proposal_feedback_learn` が outputs/tool-proposals/proposal-feedback.jsonl
 * に蓄積するエントリ群から、フィードバックループの健全性を集計する。
 *
 * - 期間別 (day) accepted / rejected の推移
 * - トピック × リソースの採択率ヒートマップ
 * - リソース毎の最新 14 日トレンド (accept rate の差分)
 *
 * 純粋関数。I/O は呼び出し側 (handler) が担当。
 */
import type { ProposalFeedbackEntry } from "./proposal-feedback.js";

export interface FeedbackVisualizationOptions {
  /** 集計対象期間 (日数)。デフォルト 30 */
  periodDays?: number;
  /** トレンド比較の窓 (日数)。デフォルト 14 */
  trendWindowDays?: number;
  /** ヒートマップに含める最小サンプル数。デフォルト 2 */
  minSamples?: number;
  /** 結果の上限件数 */
  topResources?: number;
  topTopics?: number;
  /** now 上書き (テスト用) */
  now?: Date;
}

export interface FeedbackTimePoint {
  date: string;
  accepted: number;
  rejected: number;
  acceptRate: number;
}

export interface FeedbackHeatmapCell {
  topic: string;
  resource: string;
  resourceType: ProposalFeedbackEntry["resourceType"];
  accepted: number;
  rejected: number;
  acceptRate: number;
  total: number;
}

export interface FeedbackTrend {
  resourceType: ProposalFeedbackEntry["resourceType"];
  name: string;
  recentAcceptRate: number;
  previousAcceptRate: number;
  delta: number;
  recentTotal: number;
  previousTotal: number;
}

export interface FeedbackVisualizationResult {
  generatedAt: string;
  windowDays: number;
  totals: { accepted: number; rejected: number; total: number; acceptRate: number };
  rejectReasonShare: Record<string, number>;
  timeline: FeedbackTimePoint[];
  heatmap: FeedbackHeatmapCell[];
  trends: { rising: FeedbackTrend[]; falling: FeedbackTrend[] };
}

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

function safeTime(iso: string): number | null {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : null;
}

function isAccepted(decision: ProposalFeedbackEntry["decision"]): boolean {
  return decision === "accepted";
}

function rate(accepted: number, total: number): number {
  if (total === 0) return 0;
  return Number((accepted / total).toFixed(4));
}

export function visualizeFeedbackLoop(
  entries: ProposalFeedbackEntry[],
  options: FeedbackVisualizationOptions = {}
): FeedbackVisualizationResult {
  const periodDays = options.periodDays ?? 30;
  const trendWindowDays = options.trendWindowDays ?? 14;
  const minSamples = options.minSamples ?? 2;
  const topResources = options.topResources ?? 20;
  const topTopics = options.topTopics ?? 50;
  const now = options.now ?? new Date();
  const nowMs = now.getTime();

  const periodStart = nowMs - periodDays * 24 * 60 * 60 * 1000;
  const trendCutoff = nowMs - trendWindowDays * 24 * 60 * 60 * 1000;
  const trendPrevCutoff = nowMs - 2 * trendWindowDays * 24 * 60 * 60 * 1000;

  // 期間内エントリを抽出
  const inPeriod: ProposalFeedbackEntry[] = [];
  for (const e of entries) {
    const t = safeTime(e.recordedAt);
    if (t === null) continue;
    if (t >= periodStart) inPeriod.push(e);
  }

  // totals & rejectReasonShare
  let accepted = 0;
  let rejected = 0;
  const rejectReasons: Record<string, number> = {};
  for (const e of inPeriod) {
    if (isAccepted(e.decision)) {
      accepted += 1;
    } else {
      rejected += 1;
      rejectReasons[e.decision] = (rejectReasons[e.decision] ?? 0) + 1;
    }
  }
  const total = accepted + rejected;

  // timeline: 日次集計
  const dayMap = new Map<string, { accepted: number; rejected: number }>();
  for (const e of inPeriod) {
    const key = dayKey(e.recordedAt);
    const slot = dayMap.get(key) ?? { accepted: 0, rejected: 0 };
    if (isAccepted(e.decision)) slot.accepted += 1;
    else slot.rejected += 1;
    dayMap.set(key, slot);
  }
  const timeline: FeedbackTimePoint[] = [...dayMap.entries()]
    .map(([date, v]) => ({
      date,
      accepted: v.accepted,
      rejected: v.rejected,
      acceptRate: rate(v.accepted, v.accepted + v.rejected)
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // heatmap: topic × resource
  const heatMap = new Map<string, FeedbackHeatmapCell>();
  for (const e of inPeriod) {
    const topic = (e.topic ?? "").trim();
    if (topic.length === 0) continue;
    const key = `${topic}\u0000${e.resourceType}\u0000${e.name}`;
    const slot = heatMap.get(key) ?? {
      topic,
      resource: e.name,
      resourceType: e.resourceType,
      accepted: 0,
      rejected: 0,
      acceptRate: 0,
      total: 0
    };
    if (isAccepted(e.decision)) slot.accepted += 1;
    else slot.rejected += 1;
    slot.total = slot.accepted + slot.rejected;
    slot.acceptRate = rate(slot.accepted, slot.total);
    heatMap.set(key, slot);
  }
  const heatmap = [...heatMap.values()]
    .filter((cell) => cell.total >= minSamples)
    .sort((a, b) => b.total - a.total || b.acceptRate - a.acceptRate)
    .slice(0, topTopics);

  // trends: 直近窓と直前窓の差分
  const recentMap = new Map<string, { accepted: number; rejected: number }>();
  const prevMap = new Map<string, { accepted: number; rejected: number }>();
  for (const e of entries) {
    const t = safeTime(e.recordedAt);
    if (t === null) continue;
    const key = `${e.resourceType}\u0000${e.name}`;
    if (t >= trendCutoff) {
      const slot = recentMap.get(key) ?? { accepted: 0, rejected: 0 };
      if (isAccepted(e.decision)) slot.accepted += 1;
      else slot.rejected += 1;
      recentMap.set(key, slot);
    } else if (t >= trendPrevCutoff) {
      const slot = prevMap.get(key) ?? { accepted: 0, rejected: 0 };
      if (isAccepted(e.decision)) slot.accepted += 1;
      else slot.rejected += 1;
      prevMap.set(key, slot);
    }
  }
  const trends: FeedbackTrend[] = [];
  for (const [key, recent] of recentMap.entries()) {
    const prev = prevMap.get(key) ?? { accepted: 0, rejected: 0 };
    const recentTotal = recent.accepted + recent.rejected;
    const previousTotal = prev.accepted + prev.rejected;
    if (recentTotal < minSamples && previousTotal < minSamples) continue;
    const recentRate = rate(recent.accepted, recentTotal);
    const prevRate = rate(prev.accepted, previousTotal);
    const [resourceType, name] = key.split("\u0000") as [ProposalFeedbackEntry["resourceType"], string];
    trends.push({
      resourceType,
      name,
      recentAcceptRate: recentRate,
      previousAcceptRate: prevRate,
      delta: Number((recentRate - prevRate).toFixed(4)),
      recentTotal,
      previousTotal
    });
  }
  const sortedByDelta = [...trends].sort((a, b) => b.delta - a.delta);
  const rising = sortedByDelta.filter((t) => t.delta > 0).slice(0, topResources);
  const falling = sortedByDelta.filter((t) => t.delta < 0).reverse().slice(0, topResources);

  // rejectReasonShare 正規化
  const rejectShare: Record<string, number> = {};
  if (rejected > 0) {
    for (const [k, v] of Object.entries(rejectReasons)) {
      rejectShare[k] = Number((v / rejected).toFixed(4));
    }
  }

  return {
    generatedAt: now.toISOString(),
    windowDays: periodDays,
    totals: { accepted, rejected, total, acceptRate: rate(accepted, total) },
    rejectReasonShare: rejectShare,
    timeline,
    heatmap,
    trends: { rising, falling }
  };
}
