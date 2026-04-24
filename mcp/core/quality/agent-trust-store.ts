import { existsSync, promises as fsPromises } from "node:fs";
import { dirname } from "node:path";
import type { AgentTrustHistory } from "./agent-trust-score.js";

export type AgentTrustOutcome = "accepted" | "rejected";

export interface AgentTrustHistoriesFile {
  updatedAt: string;
  histories: Record<string, AgentTrustHistory>;
}

const EMPTY_FILE: AgentTrustHistoriesFile = {
  updatedAt: new Date(0).toISOString(),
  histories: {}
};

export async function loadAgentTrustHistories(filePath: string): Promise<AgentTrustHistoriesFile> {
  if (!existsSync(filePath)) {
    return { ...EMPTY_FILE, histories: {} };
  }

  try {
    const raw = await fsPromises.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as AgentTrustHistoriesFile;
    if (!parsed || typeof parsed !== "object" || typeof parsed.histories !== "object" || parsed.histories === null) {
      return { ...EMPTY_FILE, histories: {} };
    }
    const sanitized: Record<string, AgentTrustHistory> = {};
    for (const [agent, history] of Object.entries(parsed.histories)) {
      const accepted = Math.max(0, Math.floor(Number((history as AgentTrustHistory)?.accepted ?? 0)));
      const rejected = Math.max(0, Math.floor(Number((history as AgentTrustHistory)?.rejected ?? 0)));
      sanitized[agent] = { accepted, rejected };
    }
    return {
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date(0).toISOString(),
      histories: sanitized
    };
  } catch {
    return { ...EMPTY_FILE, histories: {} };
  }
}

export async function saveAgentTrustHistories(
  filePath: string,
  data: AgentTrustHistoriesFile
): Promise<void> {
  await fsPromises.mkdir(dirname(filePath), { recursive: true });
  const payload: AgentTrustHistoriesFile = {
    updatedAt: new Date().toISOString(),
    histories: data.histories
  };
  await fsPromises.writeFile(filePath, JSON.stringify(payload, null, 2), "utf-8");
}

export function getAgentHistory(file: AgentTrustHistoriesFile, agent: string): AgentTrustHistory {
  return file.histories[agent] ?? { accepted: 0, rejected: 0 };
}

export function recordOutcome(
  file: AgentTrustHistoriesFile,
  agent: string,
  outcome: AgentTrustOutcome,
  delta: number = 1
): AgentTrustHistoriesFile {
  const safeDelta = Math.max(0, Math.floor(delta));
  if (safeDelta === 0) return file;

  const current = getAgentHistory(file, agent);
  const next: AgentTrustHistory =
    outcome === "accepted"
      ? { accepted: current.accepted + safeDelta, rejected: current.rejected }
      : { accepted: current.accepted, rejected: current.rejected + safeDelta };

  return {
    updatedAt: new Date().toISOString(),
    histories: { ...file.histories, [agent]: next }
  };
}

export async function applyAgentOutcomes(
  filePath: string,
  outcomes: Array<{ agent: string; outcome: AgentTrustOutcome; delta?: number }>
): Promise<AgentTrustHistoriesFile> {
  let file = await loadAgentTrustHistories(filePath);
  for (const entry of outcomes) {
    file = recordOutcome(file, entry.agent, entry.outcome, entry.delta ?? 1);
  }
  await saveAgentTrustHistories(filePath, file);
  return file;
}
