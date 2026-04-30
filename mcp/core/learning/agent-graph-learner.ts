import { existsSync, promises as fsPromises } from "node:fs";
import { dirname } from "node:path";
import { appendTextFileAtomic } from "../persistence/unit-of-work.js";

export interface AgentGraphRecord {
  recordedAt: string;
  sessionId?: string;
  sequence: string[];
  success: boolean;
}

export interface AgentTransitionCandidate {
  from: string;
  to: string;
  count: number;
  probability: number;
}

export interface AgentTransitionModel {
  transitions: Map<string, Map<string, number>>;
}

export async function recordAgentSequence(
  filePath: string,
  input: { sequence: string[]; sessionId?: string; success?: boolean; recordedAt?: string }
): Promise<AgentGraphRecord | null> {
  const sequence = input.sequence.map((x) => x.trim()).filter((x) => x.length > 0);
  if (sequence.length < 2) {
    return null;
  }
  const record: AgentGraphRecord = {
    recordedAt: input.recordedAt ?? new Date().toISOString(),
    sessionId: input.sessionId,
    sequence,
    success: input.success !== false
  };
  await fsPromises.mkdir(dirname(filePath), { recursive: true });
  await appendTextFileAtomic(filePath, `${JSON.stringify(record)}\n`);
  return record;
}

export async function loadAgentGraphRecords(filePath: string): Promise<AgentGraphRecord[]> {
  if (!existsSync(filePath)) {
    return [];
  }
  const raw = await fsPromises.readFile(filePath, "utf-8");
  const results: AgentGraphRecord[] = [];
  for (const line of raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0)) {
    try {
      const parsed = JSON.parse(line) as AgentGraphRecord;
      if (!Array.isArray(parsed.sequence)) continue;
      const seq = parsed.sequence.map((x) => String(x)).filter((x) => x.length > 0);
      if (seq.length < 2) continue;
      results.push({
        recordedAt: typeof parsed.recordedAt === "string" ? parsed.recordedAt : new Date(0).toISOString(),
        sessionId: parsed.sessionId,
        sequence: seq,
        success: parsed.success !== false
      });
    } catch {
      // skip malformed lines
    }
  }
  return results;
}

export function buildAgentTransitionModel(records: AgentGraphRecord[]): AgentTransitionModel {
  const transitions = new Map<string, Map<string, number>>();

  for (const record of records) {
    const weight = record.success ? 1 : 0.5;
    for (let i = 0; i < record.sequence.length - 1; i++) {
      const from = record.sequence[i];
      const to = record.sequence[i + 1];
      if (!from || !to) continue;
      const toMap = transitions.get(from) ?? new Map<string, number>();
      toMap.set(to, (toMap.get(to) ?? 0) + weight);
      transitions.set(from, toMap);
    }
  }

  return { transitions };
}

export function recommendNextAgents(params: {
  model: AgentTransitionModel;
  fromAgent: string;
  candidates?: string[];
  limit?: number;
}): AgentTransitionCandidate[] {
  const from = params.fromAgent.trim();
  if (from.length === 0) return [];

  const toMap = params.model.transitions.get(from);
  if (!toMap || toMap.size === 0) return [];

  const candidateSet = params.candidates && params.candidates.length > 0
    ? new Set(params.candidates)
    : null;

  const rows = [...toMap.entries()]
    .filter(([to]) => (candidateSet ? candidateSet.has(to) : true))
    .map(([to, count]) => ({ to, count }))
    .sort((a, b) => b.count - a.count);

  const total = rows.reduce((acc, row) => acc + row.count, 0);
  if (total <= 0) return [];

  const limit = params.limit ?? 3;
  return rows.slice(0, limit).map((row) => ({
    from,
    to: row.to,
    count: row.count,
    probability: Number((row.count / total).toFixed(4))
  }));
}
