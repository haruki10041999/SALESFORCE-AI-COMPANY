#!/usr/bin/env -S node --import tsx

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  DEFAULT_RUBRIC_CRITERIA,
  evaluateHeuristicRubric,
  evaluateQualityRubric,
  type QualityRubricResult
} from "../mcp/core/llm/quality-rubric.js";
import type { AgentMessage, ChatSession } from "../mcp/core/context/history-store.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

export interface ReplaySessionRecord {
  sessionId: string;
  topic: string;
  timestamp: string;
  agentName: string;
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  sourceFormat: "history-store" | "legacy";
}

export interface ReplayEvaluationResult {
  sessionId: string;
  topic: string;
  timestamp: string;
  agentName: string;
  sourceFormat: "history-store" | "legacy";
  evaluatedResponse: string;
  rubric: QualityRubricResult;
}

export interface ReplayComparisonResult {
  sessionId: string;
  topic: string;
  timestamp: string;
  originalAgent: string;
  baseline: ReplayEvaluationResult;
  variants: Array<{
    kind: "new-agent" | "new-prompt";
    label: string;
    rubric: QualityRubricResult;
    scoreDelta: number;
  }>;
}

export interface ReplayCliOptions {
  sessionId?: string;
  historyDir?: string;
  reportDir?: string;
  limit?: number;
  judge?: boolean;
  model?: string;
  newPrompt?: string;
  newAgent?: string;
  compare?: boolean;
}

interface LegacyChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

interface LegacyChatSessionRecord {
  sessionId: string;
  agentName: string;
  messages: LegacyChatMessage[];
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export function parseReplayArgs(args: string[]): ReplayCliOptions {
  const options: ReplayCliOptions = {};

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--session" && index + 1 < args.length) {
      options.sessionId = args[++index];
    } else if (value === "--history-dir" && index + 1 < args.length) {
      options.historyDir = args[++index];
    } else if (value === "--report-dir" && index + 1 < args.length) {
      options.reportDir = args[++index];
    } else if (value === "--limit" && index + 1 < args.length) {
      options.limit = Number.parseInt(args[++index] ?? "", 10);
    } else if (value === "--judge") {
      options.judge = true;
    } else if (value === "--model" && index + 1 < args.length) {
      options.model = args[++index];
    } else if (value === "--new-prompt" && index + 1 < args.length) {
      options.newPrompt = args[++index];
    } else if (value === "--new-agent" && index + 1 < args.length) {
      options.newAgent = args[++index];
    } else if (value === "--compare") {
      options.compare = true;
    }
  }

  return options;
}

export async function collectHistoryJsonFiles(historyDir: string): Promise<string[]> {
  const entries = await readdir(historyDir, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  });

  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(historyDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectHistoryJsonFiles(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".json")) {
      files.push(fullPath);
    }
  }
  return files;
}

export function normalizeReplaySession(raw: unknown): ReplaySessionRecord {
  const record = raw as Partial<ChatSession & LegacyChatSessionRecord>;

  if (record && typeof record.id === "string" && Array.isArray(record.entries)) {
    const entries = record.entries as AgentMessage[];
    const topic = typeof record.topic === "string" ? record.topic : "";
    const agentName = entries.at(-1)?.agent ?? record.agents?.[0] ?? "unknown-agent";
    const messages = entries.map((entry, index) => ({
      role: index === 0 ? "user" as const : "assistant" as const,
      content: entry.message
    }));
    return {
      sessionId: record.id,
      topic,
      timestamp: typeof record.timestamp === "string" ? record.timestamp : new Date(0).toISOString(),
      agentName,
      messages,
      sourceFormat: "history-store"
    };
  }

  if (record && typeof record.sessionId === "string" && Array.isArray(record.messages)) {
    return {
      sessionId: record.sessionId,
      topic: typeof record.metadata?.topic === "string" ? record.metadata.topic : "",
      timestamp: typeof record.timestamp === "string" ? record.timestamp : new Date(0).toISOString(),
      agentName: typeof record.agentName === "string" ? record.agentName : "unknown-agent",
      messages: (record.messages as LegacyChatMessage[]).map((message) => ({
        role: message.role,
        content: message.content
      })),
      sourceFormat: "legacy"
    };
  }

  throw new Error("unsupported session format");
}

export function buildEvaluatedResponse(session: ReplaySessionRecord, overrides?: { newPrompt?: string; newAgent?: string }): string {
  const lines: string[] = [];
  if (overrides?.newPrompt) {
    lines.push("# Replay Prompt Variant");
    lines.push(overrides.newPrompt);
    lines.push("");
  }
  lines.push("# Topic");
  lines.push(session.topic || "(none)");
  lines.push("");
  lines.push("# Agent");
  lines.push(overrides?.newAgent ?? session.agentName);
  lines.push("");
  lines.push("# Transcript");
  for (const message of session.messages) {
    lines.push(`## ${message.role}`);
    lines.push(message.content);
    lines.push("");
  }
  return lines.join("\n").trim();
}

export async function evaluateReplaySession(
  session: ReplaySessionRecord,
  options: Pick<ReplayCliOptions, "judge" | "model" | "newPrompt" | "newAgent">
): Promise<ReplayEvaluationResult> {
  const evaluatedResponse = buildEvaluatedResponse(session, {
    newPrompt: options.newPrompt,
    newAgent: options.newAgent
  });
  const rubric = options.judge
    ? await evaluateQualityRubric(evaluatedResponse, {
        topic: session.topic,
        model: options.model,
        fallbackOnFailure: true,
        criteria: DEFAULT_RUBRIC_CRITERIA
      })
    : evaluateHeuristicRubric(evaluatedResponse, DEFAULT_RUBRIC_CRITERIA);

  return {
    sessionId: session.sessionId,
    topic: session.topic,
    timestamp: session.timestamp,
    agentName: options.newAgent ?? session.agentName,
    sourceFormat: session.sourceFormat,
    evaluatedResponse,
    rubric
  };
}

export async function loadReplaySession(sessionId: string, historyDir: string): Promise<ReplaySessionRecord> {
  const files = await collectHistoryJsonFiles(historyDir);
  const matching = files.find((filePath) => filePath.endsWith(`${sessionId}.json`));
  if (!matching) {
    throw new Error(`session not found: ${sessionId}`);
  }
  const content = await readFile(matching, "utf-8");
  return normalizeReplaySession(JSON.parse(content));
}

export async function loadReplaySessions(historyDir: string, limit?: number): Promise<ReplaySessionRecord[]> {
  const files = await collectHistoryJsonFiles(historyDir);
  const sessions: ReplaySessionRecord[] = [];
  for (const filePath of files) {
    try {
      const content = await readFile(filePath, "utf-8");
      sessions.push(normalizeReplaySession(JSON.parse(content)));
    } catch {
      // skip corrupted or unsupported records
    }
  }
  sessions.sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime());
  return typeof limit === "number" && Number.isFinite(limit) ? sessions.slice(0, limit) : sessions;
}

export function generateReplaySummary(results: ReplayEvaluationResult[]): string {
  const average = results.length === 0
    ? 0
    : results.reduce((sum, item) => sum + item.rubric.overallScore, 0) / results.length;
  const lines = [
    "# Offline Evaluation Summary",
    `Generated: ${new Date().toISOString()}`,
    `Sessions: ${results.length}`,
    `Average score: ${average.toFixed(2)}`,
    "",
    "| Session | Agent | Score | Method | Topic |",
    "|---|---|---:|---|---|"
  ];

  for (const result of results) {
    lines.push(`| ${result.sessionId} | ${result.agentName} | ${result.rubric.overallScore.toFixed(1)} | ${result.rubric.method} | ${result.topic || "-"} |`);
  }

  return lines.join("\n");
}

export async function compareReplayVariants(
  session: ReplaySessionRecord,
  options: Pick<ReplayCliOptions, "judge" | "model" | "newPrompt" | "newAgent">
): Promise<ReplayComparisonResult> {
  const baseline = await evaluateReplaySession(session, { judge: options.judge, model: options.model });
  const variants: ReplayComparisonResult["variants"] = [];

  if (options.newAgent) {
    const replay = await evaluateReplaySession(session, {
      judge: options.judge,
      model: options.model,
      newAgent: options.newAgent
    });
    variants.push({
      kind: "new-agent",
      label: options.newAgent,
      rubric: replay.rubric,
      scoreDelta: replay.rubric.overallScore - baseline.rubric.overallScore
    });
  }

  if (options.newPrompt) {
    const replay = await evaluateReplaySession(session, {
      judge: options.judge,
      model: options.model,
      newPrompt: options.newPrompt
    });
    variants.push({
      kind: "new-prompt",
      label: options.newPrompt,
      rubric: replay.rubric,
      scoreDelta: replay.rubric.overallScore - baseline.rubric.overallScore
    });
  }

  return {
    sessionId: session.sessionId,
    topic: session.topic,
    timestamp: session.timestamp,
    originalAgent: session.agentName,
    baseline,
    variants
  };
}

export async function runReplayCli(args: string[]): Promise<number> {
  const options = parseReplayArgs(args);
  const historyDir = resolve(options.historyDir ?? join(repoRoot, "outputs", "history"));
  const reportDir = resolve(options.reportDir ?? join(repoRoot, "outputs", "reports", "learning-replay"));
  await mkdir(reportDir, { recursive: true });

  if (options.sessionId) {
    const session = await loadReplaySession(options.sessionId, historyDir);
    if (options.compare || options.newAgent || options.newPrompt) {
      const comparison = await compareReplayVariants(session, options);
      const reportPath = join(reportDir, `${session.sessionId}-comparison.json`);
      await writeFile(reportPath, JSON.stringify(comparison, null, 2), "utf-8");
      console.log(JSON.stringify({ reportPath, sessionId: session.sessionId, variants: comparison.variants.length }, null, 2));
      return 0;
    }

    const result = await evaluateReplaySession(session, options);
    const reportPath = join(reportDir, `${session.sessionId}.json`);
    await writeFile(reportPath, JSON.stringify(result, null, 2), "utf-8");
    console.log(JSON.stringify({ reportPath, sessionId: session.sessionId, score: result.rubric.overallScore }, null, 2));
    return 0;
  }

  const sessions = await loadReplaySessions(historyDir, options.limit);
  const results: ReplayEvaluationResult[] = [];
  for (const session of sessions) {
    results.push(await evaluateReplaySession(session, options));
  }
  const jsonPath = join(reportDir, "summary.json");
  const markdownPath = join(reportDir, "summary.md");
  await writeFile(jsonPath, JSON.stringify(results, null, 2), "utf-8");
  await writeFile(markdownPath, generateReplaySummary(results), "utf-8");
  console.log(JSON.stringify({ jsonPath, markdownPath, sessionCount: results.length }, null, 2));
  return 0;
}

const invokedDirectly = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;

if (invokedDirectly) {
  runReplayCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error("learning replay failed:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
