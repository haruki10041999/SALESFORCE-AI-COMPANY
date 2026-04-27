/**
 * A19: ハンドラ時間帯スケジューラ
 *
 * ツール / ハンドラに「実行可能な時間帯」のルールを設定し、
 * 指定時刻でアクティブかどうかを判定する純粋関数を提供する。
 *
 * ルール仕様:
 *  - days: 0..6 (Sun..Sat) の配列。省略時は全曜日
 *  - startHour / endHour: 0..24 の半開区間 [start, end)。
 *    end > start の場合は当日内、end <= start の場合は翌日にまたがる扱い。
 *  - timezoneOffsetMinutes: UTC からのオフセット (分)。例: JST = 540
 *  - allow: 既定 true。false にすると指定窓で「拒否」する deny リスト的に使える。
 *
 * 複数ルールがある場合の評価:
 *  1) tool に紐づく allow ルールが少なくとも 1 件マッチ → active
 *  2) deny ルールがマッチ → blocked (allow より強い)
 *  3) ルールなし → active (デフォルト許可)
 */

export interface HandlerScheduleRule {
  toolName: string;
  days?: number[];
  startHour: number;
  endHour: number;
  /** UTC offset in minutes (e.g. JST = 540, UTC = 0) */
  timezoneOffsetMinutes?: number;
  /** Default true. false の場合は deny ルール */
  allow?: boolean;
  note?: string;
}

export interface HandlerScheduleEvaluation {
  toolName: string;
  active: boolean;
  reason: string;
  matchedRule?: HandlerScheduleRule;
  evaluatedAt: string;
}

interface LocalParts {
  weekday: number;
  hour: number;
  minute: number;
}

function toLocalParts(at: Date, offsetMinutes: number): LocalParts {
  const localMs = at.getTime() + offsetMinutes * 60_000;
  const local = new Date(localMs);
  return {
    weekday: local.getUTCDay(),
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes()
  };
}

function isHourInRange(hour: number, minute: number, start: number, end: number): boolean {
  // ratioHour: 整数時 + minute/60 を比較
  const value = hour + minute / 60;
  if (start === end) return false; // empty window
  if (end > start) {
    return value >= start && value < end;
  }
  // wrap around midnight: [start, 24) ∪ [0, end)
  return value >= start || value < end;
}

function adjustWeekdayForWrap(weekday: number, hour: number, start: number, end: number): number {
  // wrap-around 窓で、深夜帯 (0..end) は前日扱いの可能性。
  // 例: start=22, end=2, JST 月曜 01:00 → 実態は日曜の窓。
  if (end > start || hour >= start) return weekday;
  return (weekday - 1 + 7) % 7;
}

function ruleMatches(rule: HandlerScheduleRule, at: Date): boolean {
  const offset = rule.timezoneOffsetMinutes ?? 0;
  const { weekday, hour, minute } = toLocalParts(at, offset);
  if (!isHourInRange(hour, minute, rule.startHour, rule.endHour)) {
    return false;
  }
  if (rule.days && rule.days.length > 0) {
    const effectiveDay = adjustWeekdayForWrap(weekday, hour, rule.startHour, rule.endHour);
    if (!rule.days.includes(effectiveDay)) return false;
  }
  return true;
}

export function evaluateHandlerSchedule(
  toolName: string,
  rules: HandlerScheduleRule[],
  at: Date = new Date()
): HandlerScheduleEvaluation {
  const evaluatedAt = at.toISOString();
  const own = rules.filter((r) => r.toolName === toolName);
  if (own.length === 0) {
    return { toolName, active: true, reason: "no-rule", evaluatedAt };
  }

  const denyMatch = own.find((r) => r.allow === false && ruleMatches(r, at));
  if (denyMatch) {
    return {
      toolName,
      active: false,
      reason: "deny-rule-matched",
      matchedRule: denyMatch,
      evaluatedAt
    };
  }

  const allowRules = own.filter((r) => r.allow !== false);
  if (allowRules.length === 0) {
    return { toolName, active: true, reason: "only-deny-rules-no-match", evaluatedAt };
  }

  const allowMatch = allowRules.find((r) => ruleMatches(r, at));
  if (allowMatch) {
    return {
      toolName,
      active: true,
      reason: "allow-rule-matched",
      matchedRule: allowMatch,
      evaluatedAt
    };
  }

  return { toolName, active: false, reason: "outside-allow-window", evaluatedAt };
}

export function evaluateAllHandlerSchedules(
  toolNames: string[],
  rules: HandlerScheduleRule[],
  at: Date = new Date()
): HandlerScheduleEvaluation[] {
  return toolNames.map((name) => evaluateHandlerSchedule(name, rules, at));
}

export function validateHandlerScheduleRule(rule: HandlerScheduleRule): string[] {
  const errors: string[] = [];
  if (!rule.toolName || rule.toolName.length === 0) errors.push("toolName required");
  if (rule.startHour < 0 || rule.startHour > 24) errors.push(`startHour out of range: ${rule.startHour}`);
  if (rule.endHour < 0 || rule.endHour > 24) errors.push(`endHour out of range: ${rule.endHour}`);
  if (rule.days) {
    for (const d of rule.days) {
      if (!Number.isInteger(d) || d < 0 || d > 6) errors.push(`day out of range: ${d}`);
    }
  }
  if (typeof rule.timezoneOffsetMinutes === "number") {
    const tz = rule.timezoneOffsetMinutes;
    if (tz < -14 * 60 || tz > 14 * 60) errors.push(`timezoneOffsetMinutes out of range: ${tz}`);
  }
  return errors;
}

export const __testables = { ruleMatches, toLocalParts, isHourInRange };
