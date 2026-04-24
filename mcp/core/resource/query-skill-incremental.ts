import { existsSync, promises as fsPromises } from "node:fs";
import { dirname } from "node:path";

export const QUERY_SKILL_MODEL_VERSION = "query-skill-v1";

export type QuerySkillFeedbackDecision = "accepted" | "rejected";

export type QuerySkillFeedbackEntry = {
  query: string;
  skill: string;
  decision: QuerySkillFeedbackDecision;
  recordedAt: string;
};

export type QuerySkillSkillStats = {
  skill: string;
  accepted: number;
  rejected: number;
  total: number;
  bias: number;
  tokenWeights: Record<string, number>;
};

export type QuerySkillIncrementalModel = {
  modelVersion: string;
  updatedAt: string;
  totals: {
    accepted: number;
    rejected: number;
    total: number;
  };
  skills: QuerySkillSkillStats[];
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9_\-\/\u3040-\u30ff\u4e00-\u9faf\s]+/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .slice(0, 40);
}

export async function appendQuerySkillFeedback(
  logFilePath: string,
  entries: QuerySkillFeedbackEntry[]
): Promise<void> {
  if (entries.length === 0) return;
  await fsPromises.mkdir(dirname(logFilePath), { recursive: true });
  const lines = entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
  await fsPromises.appendFile(logFilePath, lines, "utf-8");
}

export async function loadQuerySkillFeedbackLog(logFilePath: string): Promise<QuerySkillFeedbackEntry[]> {
  if (!existsSync(logFilePath)) {
    return [];
  }

  const raw = await fsPromises.readFile(logFilePath, "utf-8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      try {
        const parsed = JSON.parse(line) as QuerySkillFeedbackEntry;
        if (
          typeof parsed.query === "string" &&
          typeof parsed.skill === "string" &&
          (parsed.decision === "accepted" || parsed.decision === "rejected") &&
          typeof parsed.recordedAt === "string"
        ) {
          return {
            query: parsed.query.trim(),
            skill: parsed.skill.trim(),
            decision: parsed.decision,
            recordedAt: parsed.recordedAt
          };
        }
      } catch {
        // ignore malformed row
      }
      return null;
    })
    .filter((entry): entry is QuerySkillFeedbackEntry => entry !== null)
    .filter((entry) => entry.query.length > 0 && entry.skill.length > 0);
}

export function buildQuerySkillIncrementalModel(entries: QuerySkillFeedbackEntry[]): QuerySkillIncrementalModel {
  const bySkill = new Map<string, {
    accepted: number;
    rejected: number;
    tokenWeights: Map<string, number>;
  }>();

  let accepted = 0;
  let rejected = 0;

  for (const entry of entries) {
    const row = bySkill.get(entry.skill) ?? {
      accepted: 0,
      rejected: 0,
      tokenWeights: new Map<string, number>()
    };

    const decisionWeight = entry.decision === "accepted" ? 1 : -1;
    if (entry.decision === "accepted") {
      row.accepted += 1;
      accepted += 1;
    } else {
      row.rejected += 1;
      rejected += 1;
    }

    for (const token of tokenizeQuery(entry.query)) {
      const prev = row.tokenWeights.get(token) ?? 0;
      row.tokenWeights.set(token, prev + decisionWeight);
    }

    bySkill.set(entry.skill, row);
  }

  const skills: QuerySkillSkillStats[] = [...bySkill.entries()]
    .map(([skill, row]) => {
      const total = row.accepted + row.rejected;
      const bias = total > 0 ? (row.accepted - row.rejected) / total : 0;
      const tokenWeights = Object.fromEntries(
        [...row.tokenWeights.entries()]
          .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
          .slice(0, 200)
      );
      return {
        skill,
        accepted: row.accepted,
        rejected: row.rejected,
        total,
        bias: Number(bias.toFixed(4)),
        tokenWeights
      };
    })
    .sort((a, b) => b.total - a.total || a.skill.localeCompare(b.skill));

  return {
    modelVersion: QUERY_SKILL_MODEL_VERSION,
    updatedAt: new Date().toISOString(),
    totals: {
      accepted,
      rejected,
      total: accepted + rejected
    },
    skills
  };
}

export async function saveQuerySkillIncrementalModel(
  modelFilePath: string,
  model: QuerySkillIncrementalModel
): Promise<void> {
  await fsPromises.mkdir(dirname(modelFilePath), { recursive: true });
  await fsPromises.writeFile(modelFilePath, JSON.stringify(model, null, 2), "utf-8");
}

export async function loadQuerySkillIncrementalModel(
  modelFilePath: string
): Promise<QuerySkillIncrementalModel | null> {
  if (!existsSync(modelFilePath)) {
    return null;
  }
  try {
    const raw = await fsPromises.readFile(modelFilePath, "utf-8");
    const parsed = JSON.parse(raw) as QuerySkillIncrementalModel;
    if (
      parsed &&
      typeof parsed.modelVersion === "string" &&
      Array.isArray(parsed.skills) &&
      parsed.totals &&
      typeof parsed.totals.total === "number"
    ) {
      return parsed;
    }
  } catch {
    // ignore malformed model
  }
  return null;
}

export function applyQuerySkillIncrementalScore(
  baseScore: number,
  query: string,
  skill: string,
  model: QuerySkillIncrementalModel | null
): number {
  if (!model || baseScore <= 0) {
    return baseScore;
  }

  const row = model.skills.find((item) => item.skill === skill);
  if (!row) {
    return baseScore;
  }

  const tokens = tokenizeQuery(query);
  const tokenSignal = tokens.reduce((acc, token) => acc + (row.tokenWeights[token] ?? 0), 0);
  const scaledTokenSignal = tokens.length > 0 ? tokenSignal / tokens.length : 0;
  const adjustment = clamp(row.bias * 0.25 + scaledTokenSignal * 0.1, -0.35, 0.35);
  const multiplier = clamp(1 + adjustment, 0.5, 1.5);
  return baseScore * multiplier;
}