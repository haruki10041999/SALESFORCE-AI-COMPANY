import { existsSync, promises as fsPromises } from "node:fs";
import { join } from "node:path";

export type SystemEventName =
  | "session_start"
  | "turn_complete"
  | "tool_before_execute"
  | "tool_after_execute"
  | "preset_before_execute"
  | "governance_threshold_exceeded"
  | "low_relevance_detected"
  | "history_saved"
  | "error_aggregate_detected"
  | "session_end";

export interface SystemEventRecord {
  id: string;
  event: SystemEventName;
  timestamp: string;
  payload: Record<string, unknown>;
}

interface CreateSystemEventManagerDeps {
  rootDir: string;
  ensureDir: (dir: string) => Promise<void>;
  applyEventAutomation: (event: SystemEventName, payload: Record<string, unknown>) => Promise<void>;
  bridgeCoreEvent: (event: SystemEventName, timestamp: string, payload: Record<string, unknown>) => Promise<void>;
}

export function summarizeValue(value: unknown, maxChars = 400): string {
  try {
    const raw = typeof value === "string" ? value : JSON.stringify(value);
    if (!raw) return "";
    return raw.length > maxChars ? raw.slice(0, maxChars) + "...(truncated)" : raw;
  } catch {
    return String(value);
  }
}

export function createSystemEventManager(deps: CreateSystemEventManagerDeps) {
  const eventDir = join(deps.rootDir, "outputs", "events");
  const eventLogFile = join(eventDir, "system-events.jsonl");
  const recentSystemEvents: SystemEventRecord[] = [];
  const recentFailuresByTool = new Map<string, number[]>();
  const errorAggregateLastEmitted = new Map<string, number>();
  const errorAggregateWindowMs = 10 * 60 * 1000;
  const errorAggregateThreshold = 3;
  const errorAggregateCooldownMs = 60 * 1000;

  async function appendSystemEvent(record: SystemEventRecord): Promise<void> {
    await deps.ensureDir(eventDir);
    await fsPromises.appendFile(eventLogFile, JSON.stringify(record) + "\n", "utf-8");
  }

  async function emitSystemEvent(event: SystemEventName, payload: Record<string, unknown>): Promise<void> {
    const resolvedPayload = { ...payload };
    await deps.applyEventAutomation(event, resolvedPayload);

    const record: SystemEventRecord = {
      id: Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8),
      event,
      timestamp: new Date().toISOString(),
      payload: resolvedPayload
    };
    recentSystemEvents.push(record);
    if (recentSystemEvents.length > 200) {
      recentSystemEvents.splice(0, recentSystemEvents.length - 200);
    }

    try {
      await appendSystemEvent(record);
    } catch {
      // ignore event persistence failure
    }

    if (event === "error_aggregate_detected" || event === "governance_threshold_exceeded") {
      try {
        await deps.bridgeCoreEvent(event, record.timestamp, resolvedPayload);
      } catch {
        // ignore bridge failure
      }
    }
  }

  async function registerToolFailure(toolName: string, error: unknown): Promise<void> {
    const now = Date.now();
    const bucket = recentFailuresByTool.get(toolName) ?? [];
    const fresh = bucket.filter((ts) => now - ts <= errorAggregateWindowMs);
    fresh.push(now);
    recentFailuresByTool.set(toolName, fresh);

    if (fresh.length >= errorAggregateThreshold) {
      const lastEmitted = errorAggregateLastEmitted.get(toolName) ?? 0;
      if (now - lastEmitted >= errorAggregateCooldownMs) {
        errorAggregateLastEmitted.set(toolName, now);
        await emitSystemEvent("error_aggregate_detected", {
          toolName,
          failuresInWindow: fresh.length,
          windowMs: errorAggregateWindowMs,
          latestError: summarizeValue(error, 500)
        });
      }
    }
  }

  async function loadSystemEvents(limit = 50, event?: SystemEventName): Promise<SystemEventRecord[]> {
    const fromMemory = recentSystemEvents
      .filter((e) => (event ? e.event === event : true))
      .slice(-limit);

    if (fromMemory.length >= limit) {
      return fromMemory;
    }

    try {
      if (!existsSync(eventLogFile)) {
        return fromMemory;
      }
      const raw = await fsPromises.readFile(eventLogFile, "utf-8");
      const lines = raw.split("\n").filter((l) => l.trim().length > 0);
      const parsed = lines
        .map((l) => {
          try {
            return JSON.parse(l) as SystemEventRecord;
          } catch {
            return null;
          }
        })
        .filter((x): x is SystemEventRecord => x !== null)
        .filter((e) => (event ? e.event === event : true));

      const merged = [...parsed, ...fromMemory];
      return merged.slice(-limit);
    } catch {
      return fromMemory;
    }
  }

  return {
    emitSystemEvent,
    loadSystemEvents,
    registerToolFailure
  };
}
