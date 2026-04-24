/**
 * Cleanup Scheduler (TASK-041)
 *
 * cron 風スケジュール表現で自動 cleanup を回すための、軽量スケジューラ。
 *
 * - スケジュール: { id, name, cron, status, action: "dry-run" | "apply", daysUnused, limit, ... }
 * - cron は最小 5 フィールド (m h dom mon dow) のサブセットをサポート
 *   - 値の形式: アスタリスク, ステップ (slash N), カンマ列挙 (0,15,30,45), 範囲 (1-5)
 * - 永続化: outputs/cleanup-schedules.json
 * - 状態管理: active / paused
 * - フロー: list / create / update / delete / pause / resume / preview-due
 *
 * 実際のジョブ実行はホスト側（cron / scheduler）から `should_run_now` で
 * チェックして dry-run → user approval → apply のループを回す前提とする。
 */

import { existsSync, promises as fsPromises } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

export type CleanupScheduleStatus = "active" | "paused";
export type CleanupScheduleAction = "dry-run" | "apply";

export interface CleanupSchedule {
  id: string;
  name: string;
  cron: string;
  action: CleanupScheduleAction;
  status: CleanupScheduleStatus;
  daysUnused: number;
  limit: number;
  /** apply モードの場合に必要な承認フラグ */
  requireApproval: boolean;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
}

export interface CleanupSchedulesFile {
  version: number;
  updatedAt: string;
  schedules: CleanupSchedule[];
}

export const CLEANUP_SCHEDULES_FILE_VERSION = 1;

const DEFAULT_RELATIVE_PATH = join("outputs", "cleanup-schedules.json");

function isPositiveInt(value: unknown, max?: number): boolean {
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  if (!Number.isInteger(value)) return false;
  if (value <= 0) return false;
  if (typeof max === "number" && value > max) return false;
  return true;
}

/**
 * cron 1 フィールドをパースして、整数集合を返す。範囲外なら null。
 */
function parseCronField(field: string, min: number, max: number): Set<number> | null {
  const trimmed = field.trim();
  if (trimmed.length === 0) return null;
  const result = new Set<number>();

  const parts = trimmed.split(",");
  for (const partRaw of parts) {
    const part = partRaw.trim();
    if (part.length === 0) return null;

    let stepValue = 1;
    let baseExpr = part;
    const slashIdx = part.indexOf("/");
    if (slashIdx >= 0) {
      const stepStr = part.slice(slashIdx + 1);
      const step = Number.parseInt(stepStr, 10);
      if (!Number.isFinite(step) || step <= 0) return null;
      stepValue = step;
      baseExpr = part.slice(0, slashIdx);
    }

    let lo = min;
    let hi = max;
    if (baseExpr === "*") {
      // ok, full range
    } else if (baseExpr.includes("-")) {
      const [a, b] = baseExpr.split("-");
      const av = Number.parseInt(a, 10);
      const bv = Number.parseInt(b, 10);
      if (!Number.isFinite(av) || !Number.isFinite(bv)) return null;
      if (av < min || bv > max || av > bv) return null;
      lo = av;
      hi = bv;
    } else {
      const v = Number.parseInt(baseExpr, 10);
      if (!Number.isFinite(v)) return null;
      if (v < min || v > max) return null;
      lo = v;
      hi = v;
    }

    for (let n = lo; n <= hi; n += stepValue) {
      result.add(n);
    }
  }

  return result.size > 0 ? result : null;
}

export interface ParsedCronExpression {
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  daysOfWeek: Set<number>;
}

/**
 * cron 表現をパースする。失敗時は null を返す。
 */
export function parseCronExpression(expr: string): ParsedCronExpression | null {
  if (typeof expr !== "string") return null;
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const [m, h, dom, mon, dow] = fields;
  const minutes = parseCronField(m, 0, 59);
  const hours = parseCronField(h, 0, 23);
  const daysOfMonth = parseCronField(dom, 1, 31);
  const months = parseCronField(mon, 1, 12);
  const daysOfWeek = parseCronField(dow, 0, 6);
  if (!minutes || !hours || !daysOfMonth || !months || !daysOfWeek) return null;
  return { minutes, hours, daysOfMonth, months, daysOfWeek };
}

/**
 * cron 表現が指定時刻にマッチするか判定する（秒は無視）。
 */
export function cronMatches(expr: string, when: Date): boolean {
  const parsed = parseCronExpression(expr);
  if (!parsed) return false;
  return (
    parsed.minutes.has(when.getMinutes()) &&
    parsed.hours.has(when.getHours()) &&
    parsed.daysOfMonth.has(when.getDate()) &&
    parsed.months.has(when.getMonth() + 1) &&
    parsed.daysOfWeek.has(when.getDay())
  );
}

function buildEmptyFile(): CleanupSchedulesFile {
  return {
    version: CLEANUP_SCHEDULES_FILE_VERSION,
    updatedAt: new Date().toISOString(),
    schedules: []
  };
}

export function getDefaultSchedulesFilePath(rootDir: string): string {
  return join(rootDir, DEFAULT_RELATIVE_PATH);
}

export async function loadCleanupSchedules(filePath: string): Promise<CleanupSchedulesFile> {
  if (!existsSync(filePath)) {
    return buildEmptyFile();
  }
  try {
    const raw = await fsPromises.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<CleanupSchedulesFile>;
    if (!parsed || typeof parsed !== "object") return buildEmptyFile();
    const schedules = Array.isArray(parsed.schedules) ? parsed.schedules : [];
    const sanitized: CleanupSchedule[] = [];
    for (const entry of schedules) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as Partial<CleanupSchedule>;
      if (
        typeof e.id !== "string" ||
        typeof e.name !== "string" ||
        typeof e.cron !== "string" ||
        (e.action !== "dry-run" && e.action !== "apply") ||
        (e.status !== "active" && e.status !== "paused")
      ) {
        continue;
      }
      sanitized.push({
        id: e.id,
        name: e.name,
        cron: e.cron,
        action: e.action,
        status: e.status,
        daysUnused: typeof e.daysUnused === "number" ? e.daysUnused : 30,
        limit: typeof e.limit === "number" ? e.limit : 20,
        requireApproval: typeof e.requireApproval === "boolean" ? e.requireApproval : true,
        createdAt: typeof e.createdAt === "string" ? e.createdAt : new Date().toISOString(),
        updatedAt: typeof e.updatedAt === "string" ? e.updatedAt : new Date().toISOString(),
        lastRunAt: typeof e.lastRunAt === "string" ? e.lastRunAt : undefined
      });
    }
    return {
      version: CLEANUP_SCHEDULES_FILE_VERSION,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
      schedules: sanitized
    };
  } catch {
    return buildEmptyFile();
  }
}

async function ensureParentDir(filePath: string): Promise<void> {
  await fsPromises.mkdir(dirname(filePath), { recursive: true });
}

export async function saveCleanupSchedules(
  filePath: string,
  data: CleanupSchedulesFile
): Promise<void> {
  await ensureParentDir(filePath);
  const payload: CleanupSchedulesFile = {
    ...data,
    version: CLEANUP_SCHEDULES_FILE_VERSION,
    updatedAt: new Date().toISOString()
  };
  await fsPromises.writeFile(filePath, JSON.stringify(payload, null, 2), "utf-8");
}

export interface CreateCleanupScheduleInput {
  name: string;
  cron: string;
  action?: CleanupScheduleAction;
  daysUnused?: number;
  limit?: number;
  requireApproval?: boolean;
  status?: CleanupScheduleStatus;
}

export function createCleanupSchedule(
  current: CleanupSchedulesFile,
  input: CreateCleanupScheduleInput
): { file: CleanupSchedulesFile; schedule: CleanupSchedule } {
  if (!input.name || typeof input.name !== "string") {
    throw new Error("name is required");
  }
  if (!parseCronExpression(input.cron)) {
    throw new Error(`invalid cron expression: ${input.cron}`);
  }
  const action: CleanupScheduleAction = input.action === "apply" ? "apply" : "dry-run";
  const daysUnused = isPositiveInt(input.daysUnused, 365) ? (input.daysUnused as number) : 30;
  const limit = isPositiveInt(input.limit, 200) ? (input.limit as number) : 20;
  const requireApproval = input.requireApproval ?? (action === "apply");
  const status: CleanupScheduleStatus = input.status === "paused" ? "paused" : "active";
  const now = new Date().toISOString();

  const schedule: CleanupSchedule = {
    id: randomUUID(),
    name: input.name,
    cron: input.cron,
    action,
    status,
    daysUnused,
    limit,
    requireApproval,
    createdAt: now,
    updatedAt: now
  };

  const file: CleanupSchedulesFile = {
    ...current,
    schedules: [...current.schedules, schedule]
  };
  return { file, schedule };
}

export function updateCleanupSchedule(
  current: CleanupSchedulesFile,
  id: string,
  patch: Partial<Omit<CleanupSchedule, "id" | "createdAt">>
): { file: CleanupSchedulesFile; schedule: CleanupSchedule } {
  const idx = current.schedules.findIndex((s) => s.id === id);
  if (idx < 0) throw new Error(`schedule not found: ${id}`);

  if (patch.cron && !parseCronExpression(patch.cron)) {
    throw new Error(`invalid cron expression: ${patch.cron}`);
  }
  if (patch.daysUnused !== undefined && !isPositiveInt(patch.daysUnused, 365)) {
    throw new Error(`invalid daysUnused: ${patch.daysUnused}`);
  }
  if (patch.limit !== undefined && !isPositiveInt(patch.limit, 200)) {
    throw new Error(`invalid limit: ${patch.limit}`);
  }

  const existing = current.schedules[idx];
  const updated: CleanupSchedule = {
    ...existing,
    ...patch,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString()
  };
  const schedules = [...current.schedules];
  schedules[idx] = updated;
  return { file: { ...current, schedules }, schedule: updated };
}

export function deleteCleanupSchedule(
  current: CleanupSchedulesFile,
  id: string
): { file: CleanupSchedulesFile; deleted: boolean } {
  const before = current.schedules.length;
  const schedules = current.schedules.filter((s) => s.id !== id);
  return { file: { ...current, schedules }, deleted: schedules.length < before };
}

export function setCleanupScheduleStatus(
  current: CleanupSchedulesFile,
  id: string,
  status: CleanupScheduleStatus
): { file: CleanupSchedulesFile; schedule: CleanupSchedule } {
  return updateCleanupSchedule(current, id, { status });
}

/**
 * 与えられた時刻に該当する active なスケジュールを返す。
 */
export function getDueSchedules(
  current: CleanupSchedulesFile,
  when: Date
): CleanupSchedule[] {
  return current.schedules.filter(
    (s) => s.status === "active" && cronMatches(s.cron, when)
  );
}
