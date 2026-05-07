import { existsSync, promises as fsPromises } from "node:fs";
import { join, resolve } from "node:path";
import {
  aggregateAgentPersonaWeekly,
  type AgentSynergyRecord
} from "../mcp/core/learning/agent-synergy.js";

interface SessionShape {
  id?: string;
  agents?: string[];
  persona?: string;
  agentTrust?: Record<string, { accepted?: number; rejected?: number }>;
}

function deriveSessionQuality(session: SessionShape): { qualityScore: number; success: boolean } {
  const trustRows = Object.values(session.agentTrust ?? {});
  if (trustRows.length === 0) {
    return { qualityScore: 0.5, success: false };
  }
  let accepted = 0;
  let rejected = 0;
  for (const row of trustRows) {
    accepted += row.accepted ?? 0;
    rejected += row.rejected ?? 0;
  }
  const total = accepted + rejected;
  const qualityScore = total > 0 ? accepted / total : 0.5;
  return { qualityScore, success: qualityScore >= 0.6 };
}

async function loadSessionFiles(dirPath: string): Promise<SessionShape[]> {
  if (!existsSync(dirPath)) return [];
  const names = await fsPromises.readdir(dirPath);
  const sessions: SessionShape[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const filePath = join(dirPath, name);
    try {
      const raw = await fsPromises.readFile(filePath, "utf-8");
      const parsed = JSON.parse(raw) as SessionShape;
      sessions.push(parsed);
    } catch {
      // ignore malformed files
    }
  }
  return sessions;
}

async function main(): Promise<void> {
  const outputsDir = process.env.SF_AI_OUTPUTS_DIR
    ? resolve(process.env.SF_AI_OUTPUTS_DIR)
    : resolve("outputs");

  const sessionDirs = [
    join(outputsDir, "orchestration-sessions"),
    join(outputsDir, "sessions")
  ];

  const allSessions: SessionShape[] = [];
  for (const dirPath of sessionDirs) {
    const loaded = await loadSessionFiles(dirPath);
    allSessions.push(...loaded);
  }

  const records: AgentSynergyRecord[] = allSessions
    .filter((s) => Array.isArray(s.agents) && s.agents.length > 0)
    .map((session) => {
      const { qualityScore, success } = deriveSessionQuality(session);
      return {
        recordedAt: session.id?.startsWith("orch-")
          ? new Date(session.id.replace(/^orch-/, "")).toISOString()
          : new Date().toISOString(),
        agents: [...new Set((session.agents ?? []).filter((a): a is string => typeof a === "string"))].sort(),
        persona: typeof session.persona === "string" ? session.persona : "unknown",
        qualityScore,
        success,
        sessionId: session.id
      };
    });

  const weekly = aggregateAgentPersonaWeekly(records, { weeks: 12 });
  const outPath = join(outputsDir, "learning", "weekly-pair-success.json");
  await fsPromises.mkdir(join(outputsDir, "learning"), { recursive: true });
  await fsPromises.writeFile(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        totalSessions: allSessions.length,
        seriesCount: weekly.length,
        weekly
      },
      null,
      2
    ),
    "utf-8"
  );

  console.log(JSON.stringify({ saved: true, outPath, totalSessions: allSessions.length, seriesCount: weekly.length }, null, 2));
}

void main();
