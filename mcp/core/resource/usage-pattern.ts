/**
 * Usage Pattern Detection (TASK-039)
 *
 * リソースの活動パターンを daily / weekly / burst / dormant / unknown に分類する。
 *
 * 入力:
 *  - firstSeenAt: 初回登録日 (ISO)
 *  - lastUsedAt:  最終使用日 (ISO)
 *  - usageCount:  累計使用回数
 *  - now:         判定基準日（テスト容易性のため注入可）
 *
 * 分類基準:
 *  - dormant : lastUsedAt が無い / usageCount = 0
 *  - daily   : 平均使用間隔 ≦ 1.5 日 かつ最近 7 日以内に使用
 *  - weekly  : 平均使用間隔 ≦ 10 日 かつ最近 30 日以内に使用
 *  - burst   : 短期間に集中（生存日数比が高い）が、最近 14 日以上未使用
 *  - unknown : 上記いずれにも該当しない（データ不足等）
 */

export type UsagePattern = "daily" | "weekly" | "burst" | "dormant" | "unknown";

export interface UsagePatternInput {
  firstSeenAt?: string | null;
  lastUsedAt?: string | null;
  usageCount: number;
  now?: Date;
}

export interface UsagePatternResult {
  pattern: UsagePattern;
  /** 平均使用間隔（日）。算出不能なら null */
  averageIntervalDays: number | null;
  /** 最終使用からの経過日数。算出不能なら null */
  daysSinceLastUse: number | null;
  /** 生存日数（firstSeenAt から now まで）。算出不能なら null */
  lifetimeDays: number | null;
  /** 人間向けの簡潔な説明 */
  rationale: string;
}

function parseDays(now: Date, iso?: string | null): { daysSince: number | null; ts: number | null } {
  if (!iso) return { daysSince: null, ts: null };
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return { daysSince: null, ts: null };
  const diffMs = Math.max(0, now.getTime() - ts);
  return { daysSince: Math.floor(diffMs / (24 * 60 * 60 * 1000)), ts };
}

export function detectUsagePattern(input: UsagePatternInput): UsagePatternResult {
  const now = input.now ?? new Date();
  const usageCount = Math.max(0, Math.floor(input.usageCount));
  const last = parseDays(now, input.lastUsedAt);
  const first = parseDays(now, input.firstSeenAt);

  const lifetimeDays = first.daysSince;
  const daysSinceLastUse = last.daysSince;

  // dormant: 一度も使われていない、または lastUsedAt が無い
  if (usageCount === 0 || daysSinceLastUse === null) {
    return {
      pattern: "dormant",
      averageIntervalDays: null,
      daysSinceLastUse,
      lifetimeDays,
      rationale: usageCount === 0
        ? "no usage recorded"
        : "lastUsedAt is missing"
    };
  }

  // 平均使用間隔: lifetimeDays が無ければ算出不能
  let averageIntervalDays: number | null = null;
  if (lifetimeDays !== null && usageCount >= 1) {
    averageIntervalDays = Number((lifetimeDays / Math.max(1, usageCount)).toFixed(2));
  }

  // daily: 高頻度かつ直近で使用
  if (averageIntervalDays !== null && averageIntervalDays <= 1.5 && daysSinceLastUse <= 7) {
    return {
      pattern: "daily",
      averageIntervalDays,
      daysSinceLastUse,
      lifetimeDays,
      rationale: `averageInterval=${averageIntervalDays}d, recent activity within ${daysSinceLastUse}d`
    };
  }

  // weekly: 中頻度かつ最近 30 日以内
  if (averageIntervalDays !== null && averageIntervalDays <= 10 && daysSinceLastUse <= 30) {
    return {
      pattern: "weekly",
      averageIntervalDays,
      daysSinceLastUse,
      lifetimeDays,
      rationale: `averageInterval=${averageIntervalDays}d, recent activity within ${daysSinceLastUse}d`
    };
  }

  // burst: 累計 usage が一定以上だが最近未使用
  if (usageCount >= 5 && daysSinceLastUse >= 14) {
    return {
      pattern: "burst",
      averageIntervalDays,
      daysSinceLastUse,
      lifetimeDays,
      rationale: `${usageCount} uses but inactive for ${daysSinceLastUse}d`
    };
  }

  return {
    pattern: "unknown",
    averageIntervalDays,
    daysSinceLastUse,
    lifetimeDays,
    rationale: "no clear pattern; data may be insufficient"
  };
}

/**
 * pattern が cleanup 推奨を弱めるか判定する。
 *  - burst : 推奨を弱める（再度需要が来る可能性）
 *  - daily : cleanup 対象外
 */
export function shouldDeferCleanup(pattern: UsagePattern): boolean {
  return pattern === "burst" || pattern === "daily";
}
