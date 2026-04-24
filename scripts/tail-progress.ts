#!/usr/bin/env node
/**
 * tail-progress.ts
 *
 * outputs/events/system-events.jsonl を tail し、
 * tool_before_execute / tool_after_execute / session_start / session_end を
 * 進捗フォーマットで色分け表示する CLI。
 *
 * 使い方:
 *   npm run tail:progress
 *
 * オプション:
 *   --file <path>   監視対象ファイル (既定: outputs/events/system-events.jsonl)
 *   --follow=false  既存行のみ表示して終了
 */
import { existsSync, openSync, readSync, statSync, closeSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const COLORS = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m"
};

const args = process.argv.slice(2);
function getArg(name: string, fallback?: string): string | undefined {
  const idx = args.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (idx === -1) return fallback;
  const value = args[idx];
  if (value.includes("=")) return value.split("=")[1];
  return args[idx + 1] ?? fallback;
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const filePath = getArg("file", process.env.SF_AI_EVENT_LOG ?? `${ROOT}/outputs/events/system-events.jsonl`)!;
const follow = getArg("follow", "true") !== "false";

if (!existsSync(filePath)) {
  console.error(`${COLORS.red}対象ファイルが見つかりません:${COLORS.reset} ${filePath}`);
  console.error(`MCP サーバが一度起動していれば自動生成されます。`);
  process.exit(1);
}

console.log(`${COLORS.bold}${COLORS.cyan}== sf-ai progress tail ==${COLORS.reset}`);
console.log(`${COLORS.dim}target:${COLORS.reset} ${filePath}`);
console.log(`${COLORS.dim}follow:${COLORS.reset} ${follow}`);
console.log("");

interface SystemEvent {
  event?: string;
  timestamp?: string;
  payload?: Record<string, unknown>;
}

const startedAtByTrace = new Map<string, number>();

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function renderEvent(line: string): void {
  const trimmed = line.trim();
  if (!trimmed) return;
  let event: SystemEvent;
  try {
    event = JSON.parse(trimmed);
  } catch {
    return;
  }

  const ts = event.timestamp ?? new Date().toISOString();
  const payload = event.payload ?? {};
  const traceId = typeof payload.traceId === "string" ? payload.traceId : undefined;
  const toolName = typeof payload.toolName === "string" ? payload.toolName : undefined;
  const head = `${COLORS.dim}${ts}${COLORS.reset}`;

  switch (event.event) {
    case "tool_before_execute": {
      if (traceId) startedAtByTrace.set(traceId, Date.now());
      console.log(`${head} ${COLORS.cyan}>>${COLORS.reset} ${COLORS.bold}${toolName}${COLORS.reset} ${COLORS.dim}[${traceId?.slice(0, 8)}]${COLORS.reset}`);
      break;
    }
    case "tool_after_execute": {
      const success = payload.success === true;
      const retryScheduled = payload.retryScheduled === true;
      const elapsed = traceId && startedAtByTrace.has(traceId)
        ? fmtMs(Date.now() - (startedAtByTrace.get(traceId) ?? Date.now()))
        : "-";
      if (retryScheduled) {
        console.log(`${head} ${COLORS.yellow}~~${COLORS.reset} ${toolName} ${COLORS.dim}retry attempt=${String(payload.retryAttempt ?? "?")} backoff=${String(payload.nextBackoffMs ?? "?")}ms${COLORS.reset}`);
      } else if (success) {
        if (traceId) startedAtByTrace.delete(traceId);
        console.log(`${head} ${COLORS.green}<<${COLORS.reset} ${COLORS.bold}${toolName}${COLORS.reset} ${COLORS.green}OK${COLORS.reset} ${COLORS.dim}(${elapsed})${COLORS.reset}`);
      } else {
        if (traceId) startedAtByTrace.delete(traceId);
        const error = typeof payload.error === "string" ? payload.error.slice(0, 120) : "";
        console.log(`${head} ${COLORS.red}<<${COLORS.reset} ${COLORS.bold}${toolName}${COLORS.reset} ${COLORS.red}NG${COLORS.reset} ${COLORS.dim}(${elapsed})${COLORS.reset} ${COLORS.red}${error}${COLORS.reset}`);
      }
      break;
    }
    case "session_start": {
      const sessionId = payload.sessionId;
      const agents = Array.isArray(payload.agents) ? (payload.agents as string[]).join(", ") : "?";
      console.log(`${head} ${COLORS.magenta}**${COLORS.reset} session_start ${COLORS.dim}[${String(sessionId)}]${COLORS.reset} agents=${agents}`);
      break;
    }
    case "session_end": {
      const sessionId = payload.sessionId;
      const reason = payload.reason ?? "?";
      const historyCount = payload.historyCount ?? 0;
      console.log(`${head} ${COLORS.magenta}**${COLORS.reset} session_end ${COLORS.dim}[${String(sessionId)}]${COLORS.reset} reason=${String(reason)} history=${String(historyCount)}`);
      break;
    }
    default:
      // skip unrelated events
      break;
  }
}

let position = follow ? statSync(filePath).size : 0;

function readNew(): void {
  const stat = statSync(filePath);
  if (stat.size < position) {
    // file rotated/truncated → reset
    position = 0;
  }
  if (stat.size === position) return;
  const fd = openSync(filePath, "r");
  try {
    const length = stat.size - position;
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, position);
    position = stat.size;
    const text = buffer.toString("utf-8");
    const lines = text.split(/\r?\n/);
    for (const line of lines) renderEvent(line);
  } finally {
    closeSync(fd);
  }
}

if (!follow) {
  position = 0;
  readNew();
  process.exit(0);
}

readNew();
const interval = setInterval(readNew, 500);
process.on("SIGINT", () => {
  clearInterval(interval);
  console.log(`${COLORS.dim}\n-- bye --${COLORS.reset}`);
  process.exit(0);
});
