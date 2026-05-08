import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { promises as fsPromises } from "node:fs";
import { dirname, resolve } from "node:path";

export interface DriftFreezeState {
  frozen: boolean;
  reason: string;
  triggeredAt: string;
  sourceReportId?: string;
  expiresAt?: string;
  updatedAt: string;
}

export interface ActivateDriftFreezeOptions {
  reason: string;
  sourceReportId?: string;
  durationHours?: number;
  statePath?: string;
}

const DEFAULT_DRIFT_FREEZE_STATE_PATH = resolve("outputs", "learning", "drift-freeze.json");

export function resolveDriftFreezeStatePath(env: NodeJS.ProcessEnv = process.env): string {
  return env.SF_AI_DRIFT_FREEZE_STATE_PATH
    ? resolve(env.SF_AI_DRIFT_FREEZE_STATE_PATH)
    : DEFAULT_DRIFT_FREEZE_STATE_PATH;
}

export function isDriftFreezeStateActive(state: DriftFreezeState | null, nowMs = Date.now()): boolean {
  if (!state || !state.frozen) {
    return false;
  }
  if (!state.expiresAt) {
    return true;
  }
  const expiresAtMs = Date.parse(state.expiresAt);
  if (!Number.isFinite(expiresAtMs)) {
    return true;
  }
  return nowMs <= expiresAtMs;
}

function parseFreezeState(raw: string): DriftFreezeState | null {
  try {
    const parsed = JSON.parse(raw) as Partial<DriftFreezeState>;
    if (typeof parsed?.frozen !== "boolean") {
      return null;
    }
    if (typeof parsed.reason !== "string") {
      return null;
    }
    if (typeof parsed.triggeredAt !== "string") {
      return null;
    }
    return {
      frozen: parsed.frozen,
      reason: parsed.reason,
      triggeredAt: parsed.triggeredAt,
      sourceReportId: typeof parsed.sourceReportId === "string" ? parsed.sourceReportId : undefined,
      expiresAt: typeof parsed.expiresAt === "string" ? parsed.expiresAt : undefined,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : parsed.triggeredAt
    };
  } catch {
    return null;
  }
}

export function loadDriftFreezeStateSync(statePath = resolveDriftFreezeStatePath()): DriftFreezeState | null {
  if (!existsSync(statePath)) {
    return null;
  }
  try {
    return parseFreezeState(readFileSync(statePath, "utf-8"));
  } catch {
    return null;
  }
}

export async function loadDriftFreezeState(statePath = resolveDriftFreezeStatePath()): Promise<DriftFreezeState | null> {
  try {
    const raw = await fsPromises.readFile(statePath, "utf-8");
    return parseFreezeState(raw);
  } catch {
    return null;
  }
}

export function isDriftFreezeActiveSync(env: NodeJS.ProcessEnv = process.env, nowMs = Date.now()): boolean {
  const statePath = resolveDriftFreezeStatePath(env);
  const state = loadDriftFreezeStateSync(statePath);
  return isDriftFreezeStateActive(state, nowMs);
}

export async function activateDriftFreeze(options: ActivateDriftFreezeOptions): Promise<DriftFreezeState> {
  const statePath = options.statePath ? resolve(options.statePath) : resolveDriftFreezeStatePath();
  const now = new Date();
  const expiresAt = typeof options.durationHours === "number" && options.durationHours > 0
    ? new Date(now.getTime() + options.durationHours * 60 * 60 * 1000).toISOString()
    : undefined;

  const state: DriftFreezeState = {
    frozen: true,
    reason: options.reason,
    triggeredAt: now.toISOString(),
    sourceReportId: options.sourceReportId,
    expiresAt,
    updatedAt: now.toISOString()
  };

  await fsPromises.mkdir(dirname(statePath), { recursive: true });
  await fsPromises.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
  return state;
}

export async function clearDriftFreeze(statePath = resolveDriftFreezeStatePath()): Promise<void> {
  try {
    await fsPromises.unlink(statePath);
  } catch {
    // ignore missing state file
  }
}
