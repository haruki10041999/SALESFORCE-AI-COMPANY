import { existsSync, promises as fsPromises } from "node:fs";
import { dirname } from "node:path";
import { PostgresAnalyticsStore } from "../persistence/postgres-analytics-store.js";
import { appendTextFileAtomic, writeTextFileAtomic } from "../persistence/unit-of-work.js";

const analyticsStorePromise = process.env.DATABASE_URL
  ? PostgresAnalyticsStore.open({ databaseUrl: process.env.DATABASE_URL }).catch(() => null)
  : Promise.resolve(null);

export interface OutputRatioFeedbackEntry {
  recordedAt: string;
  model: string;
  agent: string;
  inputTokens: number;
  outputTokens: number;
  outputRatio: number;
  traceId?: string;
}

export interface OutputRatioAgentStats {
  agent: string;
  sampleCount: number;
  averageOutputRatio: number;
}

export interface OutputRatioModelSummary {
  model: string;
  totalSamples: number;
  averageOutputRatio: number;
  byAgent: OutputRatioAgentStats[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function safeRatio(inputTokens: number, outputTokens: number): number {
  if (inputTokens <= 0 || outputTokens < 0) return 0;
  return clamp(outputTokens / inputTokens, 0, 4);
}

export async function appendOutputRatioFeedback(
  filePath: string,
  entry: {
    model: string;
    agent?: string;
    inputTokens: number;
    outputTokens: number;
    recordedAt?: string;
    traceId?: string;
  }
): Promise<OutputRatioFeedbackEntry> {
  const normalized: OutputRatioFeedbackEntry = {
    recordedAt: entry.recordedAt ?? new Date().toISOString(),
    model: entry.model.trim().toLowerCase(),
    agent: (entry.agent ?? "unknown").trim() || "unknown",
    inputTokens: Math.max(0, Math.floor(entry.inputTokens)),
    outputTokens: Math.max(0, Math.floor(entry.outputTokens)),
    outputRatio: safeRatio(entry.inputTokens, entry.outputTokens),
    traceId: entry.traceId
  };

  const analyticsStore = await analyticsStorePromise;
  if (analyticsStore && filePath.endsWith("output-ratio.jsonl")) {
    await analyticsStore.insertOutputRatioFeedback(normalized);
    return normalized;
  }

  await fsPromises.mkdir(dirname(filePath), { recursive: true });
  await appendTextFileAtomic(filePath, `${JSON.stringify(normalized)}\n`);
  return normalized;
}

export async function loadOutputRatioFeedback(filePath: string): Promise<OutputRatioFeedbackEntry[]> {
  const analyticsStore = await analyticsStorePromise;
  if (analyticsStore && filePath.endsWith("output-ratio.jsonl")) {
    return analyticsStore.listOutputRatioFeedback();
  }

  if (!existsSync(filePath)) return [];
  const raw = await fsPromises.readFile(filePath, "utf-8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      try {
        const parsed = JSON.parse(line) as OutputRatioFeedbackEntry;
        if (
          typeof parsed.recordedAt === "string" &&
          typeof parsed.model === "string" &&
          typeof parsed.agent === "string" &&
          typeof parsed.inputTokens === "number" &&
          typeof parsed.outputTokens === "number"
        ) {
          return {
            ...parsed,
            outputRatio: safeRatio(parsed.inputTokens, parsed.outputTokens)
          };
        }
      } catch {
        // ignore malformed lines
      }
      return null;
    })
    .filter((row): row is OutputRatioFeedbackEntry => row !== null);
}

export function summarizeOutputRatioByModel(
  entries: OutputRatioFeedbackEntry[],
  options: { minSamplesPerAgent?: number } = {}
): OutputRatioModelSummary[] {
  const minSamplesPerAgent = Math.max(1, options.minSamplesPerAgent ?? 2);
  const byModel = new Map<string, OutputRatioFeedbackEntry[]>();
  for (const entry of entries) {
    const key = entry.model;
    const rows = byModel.get(key) ?? [];
    rows.push(entry);
    byModel.set(key, rows);
  }

  const summaries: OutputRatioModelSummary[] = [];
  for (const [model, rows] of byModel.entries()) {
    const byAgent = new Map<string, OutputRatioFeedbackEntry[]>();
    for (const row of rows) {
      const bucket = byAgent.get(row.agent) ?? [];
      bucket.push(row);
      byAgent.set(row.agent, bucket);
    }

    const agentStats: OutputRatioAgentStats[] = [...byAgent.entries()]
      .map(([agent, values]) => {
        const avg = values.reduce((sum, v) => sum + v.outputRatio, 0) / values.length;
        return {
          agent,
          sampleCount: values.length,
          averageOutputRatio: Number(avg.toFixed(4))
        };
      })
      .filter((row) => row.sampleCount >= minSamplesPerAgent)
      .sort((a, b) => b.sampleCount - a.sampleCount || b.averageOutputRatio - a.averageOutputRatio);

    const modelAvg = rows.length > 0
      ? rows.reduce((sum, row) => sum + row.outputRatio, 0) / rows.length
      : 0;

    summaries.push({
      model,
      totalSamples: rows.length,
      averageOutputRatio: Number(modelAvg.toFixed(4)),
      byAgent: agentStats
    });
  }

  return summaries.sort((a, b) => b.totalSamples - a.totalSamples || a.model.localeCompare(b.model));
}

export async function writePricingFromOutputRatioFeedback(
  pricingPath: string,
  summaries: OutputRatioModelSummary[]
): Promise<void> {
  const existing = await (async () => {
    if (!existsSync(pricingPath)) return {} as Record<string, unknown>;
    try {
      const raw = await fsPromises.readFile(pricingPath, "utf-8");
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {} as Record<string, unknown>;
    }
  })();

  const models = (typeof existing.models === "object" && existing.models !== null
    ? existing.models
    : {}) as Record<string, Record<string, unknown>>;

  for (const summary of summaries) {
    const modelRow = models[summary.model] ?? {};
    modelRow.feedbackOutputRatio = summary.averageOutputRatio;
    modelRow.feedbackOutputRatioByAgent = Object.fromEntries(
      summary.byAgent.map((row) => [row.agent, { ratio: row.averageOutputRatio, sampleCount: row.sampleCount }])
    );
    models[summary.model] = modelRow;
  }

  const next = {
    ...existing,
    models,
    feedbackUpdatedAt: new Date().toISOString()
  };

  await fsPromises.mkdir(dirname(pricingPath), { recursive: true });
  await writeTextFileAtomic(pricingPath, JSON.stringify(next, null, 2));
}
