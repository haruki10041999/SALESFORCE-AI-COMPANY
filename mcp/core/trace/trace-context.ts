/**
 * Trace Context
 *
 * ツール呼び出し全体に一意の trace ID を付与し、
 * ログ・イベントを横断的に紐付ける仕組みを提供する。
 *
 * 使用方法:
 *   import { startTrace, endTrace, failTrace, withTrace } from "../core/trace/trace-context.js";
 *
 *   const traceId = startTrace("tool_name");
 *   try { ... } finally { endTrace(traceId); }
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createLogger } from "../logging/logger.js";

const logger = createLogger("TraceContext");

export interface TraceEntry {
  traceId: string;
  toolName: string;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  status: "running" | "success" | "error";
  errorMessage?: string;
  metadata: Record<string, unknown>;
}

/** アクティブトレース（traceId → TraceEntry） */
const activeTraces = new Map<string, TraceEntry>();

/** 直近 N 件の完了トレースをリングバッファで保持 */
const MAX_COMPLETED = Number.parseInt(process.env.TRACE_HISTORY_MAX ?? "500", 10);
const completedTraces: TraceEntry[] = [];

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const DEFAULT_TRACE_FILE = join(ROOT, "outputs", "events", "trace-log.jsonl");
let traceFilePath = process.env.SF_AI_TRACE_FILE ?? DEFAULT_TRACE_FILE;

function loadTracesFromDisk(): void {
  completedTraces.length = 0;
  if (!existsSync(traceFilePath)) {
    return;
  }
  try {
    const raw = readFileSync(traceFilePath, "utf-8");
    const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as Partial<TraceEntry>;
        if (
          typeof parsed.traceId === "string" &&
          typeof parsed.toolName === "string" &&
          typeof parsed.startedAt === "string" &&
          (parsed.status === "success" || parsed.status === "error" || parsed.status === "running")
        ) {
          completedTraces.push({
            traceId: parsed.traceId,
            toolName: parsed.toolName,
            startedAt: parsed.startedAt,
            endedAt: parsed.endedAt,
            durationMs: parsed.durationMs,
            status: parsed.status,
            errorMessage: parsed.errorMessage,
            metadata: typeof parsed.metadata === "object" && parsed.metadata !== null
              ? (parsed.metadata as Record<string, unknown>)
              : {}
          });
        }
      } catch {
        // ignore malformed lines
      }
    }
    if (completedTraces.length > MAX_COMPLETED) {
      completedTraces.splice(0, completedTraces.length - MAX_COMPLETED);
    }
  } catch {
    // keep runtime resilient even if trace file is unreadable
  }
}

function persistTracesToDisk(): void {
  try {
    mkdirSync(dirname(traceFilePath), { recursive: true });
    const normalized = completedTraces.slice(-MAX_COMPLETED);
    const payload = normalized.map((entry) => JSON.stringify(entry)).join("\n");
    writeFileSync(traceFilePath, payload.length > 0 ? `${payload}\n` : "", "utf-8");
  } catch {
    // keep runtime resilient even if trace file is unwritable
  }
}

/** 新しいトレースを開始し traceId を返す */
export function startTrace(
  toolName: string,
  metadata: Record<string, unknown> = {}
): string {
  const traceId = randomUUID();
  const entry: TraceEntry = {
    traceId,
    toolName,
    startedAt: new Date().toISOString(),
    status: "running",
    metadata
  };
  activeTraces.set(traceId, entry);
  logger.debug(`[trace:start] ${traceId} tool=${toolName}`);
  return traceId;
}

/** トレースを成功で終了 */
export function endTrace(traceId: string, meta?: Record<string, unknown>): void {
  const entry = activeTraces.get(traceId);
  if (!entry) return;
  entry.endedAt = new Date().toISOString();
  entry.durationMs = Date.now() - new Date(entry.startedAt).getTime();
  entry.status = "success";
  if (meta) Object.assign(entry.metadata, meta);
  _pushCompleted(entry);
  activeTraces.delete(traceId);
  logger.debug(`[trace:end] ${traceId} tool=${entry.toolName} ${entry.durationMs}ms`);
}

/** トレースをエラーで終了 */
export function failTrace(traceId: string, error: unknown): void {
  const entry = activeTraces.get(traceId);
  if (!entry) return;
  entry.endedAt = new Date().toISOString();
  entry.durationMs = Date.now() - new Date(entry.startedAt).getTime();
  entry.status = "error";
  entry.errorMessage = error instanceof Error ? error.message : String(error);
  _pushCompleted(entry);
  activeTraces.delete(traceId);
  logger.debug(
    `[trace:fail] ${traceId} tool=${entry.toolName} ${entry.durationMs}ms err=${entry.errorMessage}`
  );
}

function _pushCompleted(entry: TraceEntry): void {
  completedTraces.push(entry);
  if (completedTraces.length > MAX_COMPLETED) {
    completedTraces.splice(0, completedTraces.length - MAX_COMPLETED);
  }
  persistTracesToDisk();
}

/** 直近の完了トレース一覧を返す（新しい順） */
export function getCompletedTraces(limit = 50): TraceEntry[] {
  return completedTraces.slice(-limit).reverse();
}

/** アクティブトレース一覧を返す */
export function getActiveTraces(): TraceEntry[] {
  return Array.from(activeTraces.values());
}

/** 特定 traceId のエントリを返す（完了済みも含む） */
export function findTrace(traceId: string): TraceEntry | undefined {
  return activeTraces.get(traceId) ?? completedTraces.find((t) => t.traceId === traceId);
}

export function configureTraceStorageForTest(filePath: string): void {
  traceFilePath = filePath;
  loadTracesFromDisk();
}

export function clearTraceStorageForTest(): void {
  activeTraces.clear();
  completedTraces.length = 0;
  persistTracesToDisk();
}

/**
 * ツールハンドラーを Trace でラップするヘルパー
 *
 * 例:
 *   handler = withTrace("repo_analyze", handler);
 */
export function withTrace<TInput, TOutput>(
  toolName: string,
  fn: (input: TInput) => Promise<TOutput>
): (input: TInput) => Promise<TOutput> {
  return async (input: TInput): Promise<TOutput> => {
    const traceId = startTrace(toolName);
    try {
      const result = await fn(input);
      endTrace(traceId);
      return result;
    } catch (err) {
      failTrace(traceId, err);
      throw err;
    }
  };
}

loadTracesFromDisk();
