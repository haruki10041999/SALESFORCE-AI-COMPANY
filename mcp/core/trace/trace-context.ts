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

export type ReasoningStage = "think" | "do" | "check";

export interface ReasoningStep {
  stage: ReasoningStage;
  message: string;
  timestamp: string;
  agent?: string;
  details?: string;
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

function normalizeReasoningSteps(value: unknown): ReasoningStep[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: ReasoningStep[] = [];
  for (const step of value) {
    if (!step || typeof step !== "object") {
      continue;
    }
    const candidate = step as Partial<ReasoningStep>;
    if (
      (candidate.stage === "think" || candidate.stage === "do" || candidate.stage === "check") &&
      typeof candidate.message === "string" &&
      typeof candidate.timestamp === "string"
    ) {
      normalized.push({
        stage: candidate.stage,
        message: candidate.message,
        timestamp: candidate.timestamp,
        agent: typeof candidate.agent === "string" ? candidate.agent : undefined,
        details: typeof candidate.details === "string" ? candidate.details : undefined
      });
    }
  }

  return normalized;
}

export function appendTraceReasoningStep(
  traceId: string,
  step: {
    stage: ReasoningStage;
    message: string;
    agent?: string;
    details?: string;
  }
): ReasoningStep[] {
  const entry = findTrace(traceId);
  if (!entry) {
    throw new Error(`Trace not found: ${traceId}`);
  }

  const currentSteps = normalizeReasoningSteps(entry.metadata.reasoningSteps);
  const newStep: ReasoningStep = {
    stage: step.stage,
    message: step.message,
    timestamp: new Date().toISOString(),
    agent: step.agent,
    details: step.details
  };

  const nextSteps = [...currentSteps, newStep];
  entry.metadata.reasoningSteps = nextSteps;
  return nextSteps;
}

export function getTraceReasoningSteps(traceId: string): ReasoningStep[] {
  const entry = findTrace(traceId);
  if (!entry) {
    return [];
  }
  return normalizeReasoningSteps(entry.metadata.reasoningSteps);
}

function stageLabel(stage: ReasoningStage): string {
  if (stage === "think") return "Think";
  if (stage === "do") return "Do";
  return "Check";
}

export function renderTraceReasoningMarkdown(traceId: string): string {
  const entry = findTrace(traceId);
  if (!entry) {
    return `# Trace Reasoning\n\nTrace not found: ${traceId}`;
  }

  const steps = getTraceReasoningSteps(traceId);
  const lines: string[] = [];
  lines.push("# Trace Reasoning");
  lines.push("");
  lines.push(`- traceId: ${entry.traceId}`);
  lines.push(`- toolName: ${entry.toolName}`);
  lines.push(`- status: ${entry.status}`);
  lines.push(`- steps: ${steps.length}`);
  lines.push("");

  if (steps.length === 0) {
    lines.push("No reasoning steps recorded.");
    return lines.join("\n");
  }

  lines.push("## Sequence");
  lines.push("");
  for (const step of steps) {
    const actor = step.agent ? ` (${step.agent})` : "";
    lines.push(`- **${stageLabel(step.stage)}**${actor}: ${step.message}`);
    if (step.details) {
      lines.push(`  - details: ${step.details}`);
    }
  }

  return lines.join("\n");
}

export function renderTraceReasoningMermaid(traceId: string): string {
  const entry = findTrace(traceId);
  const steps = getTraceReasoningSteps(traceId);

  const lines: string[] = [];
  lines.push("sequenceDiagram");
  lines.push("  participant Agent");
  lines.push("  participant System");

  if (!entry || steps.length === 0) {
    lines.push("  Note over System: No reasoning steps recorded");
    return lines.join("\n");
  }

  for (const step of steps) {
    const actor = step.agent?.trim() ? step.agent.trim() : "Agent";
    const escaped = step.message.replace(/\n/g, " ").replace(/:/g, "-");
    lines.push(`  ${actor}->>System: ${stageLabel(step.stage)} | ${escaped}`);
  }

  return lines.join("\n");
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
