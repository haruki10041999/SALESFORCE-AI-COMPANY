import { existsSync, promises as fsPromises } from "node:fs";
import { join } from "node:path";
import { maskUnknown } from "../logging/pii-masker.js";
import { appendTextFileAtomic } from "../persistence/unit-of-work.js";

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

export interface SystemEventLogStatus {
  eventDir: string;
  activeLogPath: string;
  activeLogExists: boolean;
  activeLogSizeBytes: number;
  archiveCount: number;
  archiveTotalSizeBytes: number;
  archives: Array<{ file: string; sizeBytes: number; modifiedAt: string }>;
}

interface CreateSystemEventManagerDeps {
  rootDir: string;
  outputsDir?: string;
  maxLogFileBytes?: number;
  maxArchivedFiles?: number;
  retentionDays?: number;
  ensureDir: (dir: string) => Promise<void>;
  applyEventAutomation: (event: SystemEventName, payload: Record<string, unknown>) => Promise<void>;
  bridgeCoreEvent: (event: SystemEventName, timestamp: string, payload: Record<string, unknown>) => Promise<void>;
}

export function summarizeValue(value: unknown, maxChars = 400): string {
  try {
    if (value instanceof Error) {
      const stackLine = value.stack?.split("\n")[1]?.trim();
      const errorText = stackLine ? `${value.message}\n${stackLine}` : value.message;
      return errorText.length > maxChars ? errorText.slice(0, maxChars) + "...(truncated)" : errorText;
    }
    const raw = typeof value === "string" ? value : JSON.stringify(value);
    if (!raw) return "";
    return raw.length > maxChars ? raw.slice(0, maxChars) + "...(truncated)" : raw;
  } catch {
    return String(value);
  }
}

export function createSystemEventManager(deps: CreateSystemEventManagerDeps) {
  const outputsDir = deps.outputsDir ?? join(deps.rootDir, "outputs");
  const eventDir = join(outputsDir, "events");
  const eventLogFile = join(eventDir, "system-events.jsonl");
  const maxLogFileBytes = Math.max(1024, deps.maxLogFileBytes ?? 2 * 1024 * 1024);
  const maxArchivedFiles = Math.max(1, deps.maxArchivedFiles ?? 30);
  const retentionMs = Math.max(1, deps.retentionDays ?? 30) * 24 * 60 * 60 * 1000;
  const recentSystemEvents: SystemEventRecord[] = [];
  const recentFailuresByTool = new Map<string, number[]>();
  const errorAggregateLastEmitted = new Map<string, number>();
  const errorAggregateWindowMs = 10 * 60 * 1000;
  const errorAggregateThreshold = 3;
  const errorAggregateCooldownMs = 60 * 1000;

  function isArchivedEventLog(file: string): boolean {
    return file !== "system-events.jsonl" && file.startsWith("system-events.") && file.endsWith(".jsonl");
  }

  function createArchiveFileName(timestamp: string): string {
    const safeStamp = timestamp.replace(/[:.]/g, "-");
    const nonce = Math.random().toString(36).slice(2, 8);
    return `system-events.${safeStamp}.${nonce}.jsonl`;
  }

  async function pruneArchivedEventLogs(): Promise<void> {
    const now = Date.now();
    const files = await fsPromises.readdir(eventDir);
    const archives = await Promise.all(
      files
        .filter((file) => isArchivedEventLog(file))
        .map(async (file) => {
          const fullPath = join(eventDir, file);
          const stat = await fsPromises.stat(fullPath);
          return {
            file,
            fullPath,
            mtimeMs: stat.mtimeMs
          };
        })
    );

    for (const archive of archives) {
      if (now - archive.mtimeMs > retentionMs) {
        try {
          await fsPromises.unlink(archive.fullPath);
        } catch {
          // ignore retention cleanup failures
        }
      }
    }

    const remaining = (await Promise.all(
      (await fsPromises.readdir(eventDir))
        .filter((file) => isArchivedEventLog(file))
        .map(async (file) => {
          const fullPath = join(eventDir, file);
          const stat = await fsPromises.stat(fullPath);
          return {
            fullPath,
            mtimeMs: stat.mtimeMs
          };
        })
    )).sort((a, b) => b.mtimeMs - a.mtimeMs);

    const overflow = Math.max(0, remaining.length - maxArchivedFiles);
    if (overflow > 0) {
      for (const item of remaining.slice(-overflow)) {
        try {
          await fsPromises.unlink(item.fullPath);
        } catch {
          // ignore overflow cleanup failures
        }
      }
    }
  }

  async function rotateEventLogIfNeeded(nextLine: string): Promise<void> {
    await deps.ensureDir(eventDir);
    if (!existsSync(eventLogFile)) {
      return;
    }

    const stat = await fsPromises.stat(eventLogFile);
    const nextBytes = Buffer.byteLength(nextLine, "utf-8");
    if (stat.size + nextBytes <= maxLogFileBytes) {
      return;
    }

    const archivePath = join(eventDir, createArchiveFileName(new Date().toISOString()));
    try {
      await fsPromises.rename(eventLogFile, archivePath);
    } catch {
      // ignore rotate failure; keep appending to active file
      return;
    }
    await pruneArchivedEventLogs();
  }

  async function appendSystemEvent(record: SystemEventRecord): Promise<void> {
    const line = JSON.stringify(maskUnknown(record)) + "\n";
    await rotateEventLogIfNeeded(line);
    await appendTextFileAtomic(eventLogFile, line);
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
      await deps.ensureDir(eventDir);
      const files = await fsPromises.readdir(eventDir);
      const archiveFiles = await Promise.all(
        files
          .filter((file) => isArchivedEventLog(file))
          .map(async (file) => {
            const fullPath = join(eventDir, file);
            const stat = await fsPromises.stat(fullPath);
            return { fullPath, mtimeMs: stat.mtimeMs };
          })
      );
      archiveFiles.sort((a, b) => a.mtimeMs - b.mtimeMs);
      const filesToRead = [...archiveFiles.map((f) => f.fullPath)];
      if (existsSync(eventLogFile)) {
        filesToRead.push(eventLogFile);
      }

      if (filesToRead.length === 0) {
        return fromMemory;
      }

      const parsed: SystemEventRecord[] = [];
      for (const filePath of filesToRead) {
        const raw = await fsPromises.readFile(filePath, "utf-8");
        const lines = raw.split("\n").filter((line) => line.trim().length > 0);
        for (const line of lines) {
          try {
            const record = JSON.parse(line) as SystemEventRecord;
            if (!event || record.event === event) {
              parsed.push(record);
            }
          } catch {
            // ignore malformed lines
          }
        }
      }

      const deduped = new Map<string, SystemEventRecord>();
      for (const record of [...parsed, ...fromMemory]) {
        deduped.set(record.id, record);
      }
      return [...deduped.values()].slice(-limit);
    } catch {
      return fromMemory;
    }
  }

  async function getSystemEventLogStatus(): Promise<SystemEventLogStatus> {
    await deps.ensureDir(eventDir);

    let activeLogExists = false;
    let activeLogSizeBytes = 0;
    try {
      const activeStat = await fsPromises.stat(eventLogFile);
      activeLogExists = true;
      activeLogSizeBytes = activeStat.size;
    } catch {
      activeLogExists = false;
      activeLogSizeBytes = 0;
    }

    const files = await fsPromises.readdir(eventDir);
    const archives = await Promise.all(
      files
        .filter((file) => isArchivedEventLog(file))
        .map(async (file) => {
          const fullPath = join(eventDir, file);
          const stat = await fsPromises.stat(fullPath);
          return {
            file,
            sizeBytes: stat.size,
            modifiedAt: stat.mtime.toISOString(),
            mtimeMs: stat.mtimeMs
          };
        })
    );

    archives.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const archiveTotalSizeBytes = archives.reduce((sum, archive) => sum + archive.sizeBytes, 0);

    return {
      eventDir,
      activeLogPath: eventLogFile,
      activeLogExists,
      activeLogSizeBytes,
      archiveCount: archives.length,
      archiveTotalSizeBytes,
      archives: archives.map(({ file, sizeBytes, modifiedAt }) => ({ file, sizeBytes, modifiedAt }))
    };
  }

  return {
    emitSystemEvent,
    loadSystemEvents,
    registerToolFailure,
    getSystemEventLogStatus
  };
}
