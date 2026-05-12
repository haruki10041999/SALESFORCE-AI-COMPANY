import { promises as fsPromises } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { getAnalyticsStore } from "../persistence/analytics-store-provider.js";
import { appendTextFileAtomic } from "../persistence/unit-of-work.js";

export type ReputationScope = "global" | "topic" | "org" | "user";

export type AgentReputationRecord = {
  id: string;
  timestamp: string;
  agentName: string;
  scope: ReputationScope;
  scopeKey: string;
  delta: number;
  scoreBefore: number;
  scoreAfter: number;
  reason?: string;
};

export type AgentReputationSnapshot = {
  global: number;
  topic?: { key: string; score: number };
  org?: { key: string; score: number };
  user?: { key: string; score: number };
  effective: number;
};

const DEFAULT_PATH = resolve("outputs", "agent-reputation.jsonl");
const DEFAULT_BASE_SCORE = 0.5;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_BASE_SCORE;
  return Math.max(0, Math.min(1, Number(value.toFixed(3))));
}

function normalizeScopeKey(scope: ReputationScope, scopeKey?: string): string {
  if (scope === "global") return "global";
  return (scopeKey ?? "").trim();
}

export async function loadAgentReputationRecords(filePath = DEFAULT_PATH): Promise<AgentReputationRecord[]> {
  const analyticsStore = await getAnalyticsStore();
  if (analyticsStore && filePath === DEFAULT_PATH) {
    return analyticsStore.listAgentReputationRecords();
  }

  try {
    const raw = await fsPromises.readFile(filePath, "utf-8");
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        try {
          const parsed = JSON.parse(line) as AgentReputationRecord;
          if (!parsed.agentName || !parsed.scope || !parsed.scopeKey) return null;
          if (typeof parsed.delta !== "number") return null;
          return {
            ...parsed,
            scoreBefore: clamp01(parsed.scoreBefore),
            scoreAfter: clamp01(parsed.scoreAfter)
          };
        } catch {
          return null;
        }
      })
      .filter((row): row is AgentReputationRecord => row !== null);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw new Error(`Failed to load agent reputation records: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function computeAgentReputationScore(
  records: AgentReputationRecord[],
  agentName: string,
  scope: ReputationScope,
  scopeKey?: string,
  baseScore = DEFAULT_BASE_SCORE
): number {
  const normalizedScopeKey = normalizeScopeKey(scope, scopeKey);
  if ((scope === "topic" || scope === "org" || scope === "user") && normalizedScopeKey.length === 0) {
    throw new Error(`scopeKey is required for scope '${scope}'`);
  }

  const candidates = records
    .filter((record) => record.agentName === agentName && record.scope === scope && record.scopeKey === normalizedScopeKey)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  if (candidates.length === 0) {
    return clamp01(baseScore);
  }
  return clamp01(candidates[candidates.length - 1]?.scoreAfter ?? baseScore);
}

export async function updateAgentReputation(input: {
  agentName: string;
  scope: ReputationScope;
  scopeKey?: string;
  delta: number;
  reason?: string;
  filePath?: string;
  baseScore?: number;
}): Promise<AgentReputationRecord> {
  const filePath = input.filePath ?? DEFAULT_PATH;
  const records = await loadAgentReputationRecords(filePath);
  const now = new Date().toISOString();
  const scoreBefore = computeAgentReputationScore(
    records,
    input.agentName,
    input.scope,
    input.scopeKey,
    input.baseScore ?? DEFAULT_BASE_SCORE
  );

  const record: AgentReputationRecord = {
    id: randomUUID(),
    timestamp: now,
    agentName: input.agentName,
    scope: input.scope,
    scopeKey: normalizeScopeKey(input.scope, input.scopeKey),
    delta: Number(input.delta.toFixed(3)),
    scoreBefore,
    scoreAfter: clamp01(scoreBefore + input.delta),
    reason: input.reason
  };

  const analyticsStore = await getAnalyticsStore();
  if (analyticsStore && filePath === DEFAULT_PATH) {
    await analyticsStore.insertAgentReputationRecord(record);
    return record;
  }

  await fsPromises.mkdir(dirname(filePath), { recursive: true });
  await appendTextFileAtomic(filePath, `${JSON.stringify(record)}\n`);
  return record;
}

export function buildAgentReputationSnapshot(
  records: AgentReputationRecord[],
  params: {
    agentName: string;
    topic?: string;
    org?: string;
    user?: string;
    baseScore?: number;
  }
): AgentReputationSnapshot {
  const baseScore = params.baseScore ?? DEFAULT_BASE_SCORE;
  const global = computeAgentReputationScore(records, params.agentName, "global", "global", baseScore);

  const topicScore = params.topic && params.topic.trim().length > 0
    ? computeAgentReputationScore(records, params.agentName, "topic", params.topic, baseScore)
    : undefined;
  const orgScore = params.org && params.org.trim().length > 0
    ? computeAgentReputationScore(records, params.agentName, "org", params.org, baseScore)
    : undefined;
  const userScore = params.user && params.user.trim().length > 0
    ? computeAgentReputationScore(records, params.agentName, "user", params.user, baseScore)
    : undefined;

  const effectiveParts = [global, topicScore, orgScore, userScore].filter((v): v is number => typeof v === "number");
  const effective = clamp01(effectiveParts.reduce((acc, value) => acc + value, 0) / Math.max(1, effectiveParts.length));

  return {
    global,
    topic: topicScore === undefined ? undefined : { key: params.topic!, score: topicScore },
    org: orgScore === undefined ? undefined : { key: params.org!, score: orgScore },
    user: userScore === undefined ? undefined : { key: params.user!, score: userScore },
    effective
  };
}

export function toReputationMapByAgent(
  records: AgentReputationRecord[],
  baseScore = DEFAULT_BASE_SCORE
): Record<string, number> {
  const agents = [...new Set(records.map((record) => record.agentName))];
  const out: Record<string, number> = {};
  for (const agentName of agents) {
    out[agentName] = computeAgentReputationScore(records, agentName, "global", "global", baseScore);
  }
  return out;
}
