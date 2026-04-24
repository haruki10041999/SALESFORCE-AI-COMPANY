import { existsSync, promises as fsPromises } from "node:fs";
import { dirname } from "node:path";

export type FeedbackResourceType = "skills" | "tools" | "presets";
export type FeedbackDecision = "accepted" | "rejected";

export type ProposalFeedbackEntry = {
  resourceType: FeedbackResourceType;
  name: string;
  decision: FeedbackDecision;
  topic?: string;
  note?: string;
  recordedAt: string;
};

export type ProposalFeedbackStats = {
  resourceType: FeedbackResourceType;
  name: string;
  accepted: number;
  rejected: number;
  total: number;
  acceptRate: number;
  adjustment: number;
};

export type ProposalFeedbackModel = {
  updatedAt: string;
  minSamples: number;
  totals: {
    accepted: number;
    rejected: number;
    total: number;
  };
  typeAdjustments: Record<FeedbackResourceType, number>;
  resources: ProposalFeedbackStats[];
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function toAdjustment(accepted: number, rejected: number): number {
  const total = accepted + rejected;
  const acceptRate = (accepted + 1) / (total + 2); // Laplace smoothing
  const centered = acceptRate - 0.5;
  const confidence = Math.min(1, total / 10);
  return clamp(centered * 0.8 * confidence, -0.3, 0.3);
}

export async function appendProposalFeedback(logFilePath: string, entries: ProposalFeedbackEntry[]): Promise<void> {
  if (entries.length === 0) return;

  await fsPromises.mkdir(dirname(logFilePath), { recursive: true });
  const lines = entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
  await fsPromises.appendFile(logFilePath, lines, "utf-8");
}

export async function loadProposalFeedbackLog(logFilePath: string): Promise<ProposalFeedbackEntry[]> {
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
        const parsed = JSON.parse(line) as ProposalFeedbackEntry;
        if (
          (parsed.resourceType === "skills" || parsed.resourceType === "tools" || parsed.resourceType === "presets") &&
          typeof parsed.name === "string" &&
          (parsed.decision === "accepted" || parsed.decision === "rejected")
        ) {
          return parsed;
        }
      } catch {
        // ignore broken lines
      }
      return null;
    })
    .filter((entry): entry is ProposalFeedbackEntry => entry !== null);
}

export function buildProposalFeedbackModel(
  entries: ProposalFeedbackEntry[],
  minSamples: number
): ProposalFeedbackModel {
  const byResource = new Map<string, { resourceType: FeedbackResourceType; name: string; accepted: number; rejected: number }>();
  const typeCounter: Record<FeedbackResourceType, { accepted: number; rejected: number }> = {
    skills: { accepted: 0, rejected: 0 },
    tools: { accepted: 0, rejected: 0 },
    presets: { accepted: 0, rejected: 0 }
  };

  for (const entry of entries) {
    const key = `${entry.resourceType}:${entry.name}`;
    const current = byResource.get(key) ?? {
      resourceType: entry.resourceType,
      name: entry.name,
      accepted: 0,
      rejected: 0
    };

    if (entry.decision === "accepted") {
      current.accepted += 1;
      typeCounter[entry.resourceType].accepted += 1;
    } else {
      current.rejected += 1;
      typeCounter[entry.resourceType].rejected += 1;
    }

    byResource.set(key, current);
  }

  const resources: ProposalFeedbackStats[] = [...byResource.values()]
    .map((row) => {
      const total = row.accepted + row.rejected;
      return {
        resourceType: row.resourceType,
        name: row.name,
        accepted: row.accepted,
        rejected: row.rejected,
        total,
        acceptRate: total > 0 ? row.accepted / total : 0,
        adjustment: total >= minSamples ? toAdjustment(row.accepted, row.rejected) : 0
      };
    })
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

  const totals = {
    accepted: entries.filter((entry) => entry.decision === "accepted").length,
    rejected: entries.filter((entry) => entry.decision === "rejected").length,
    total: entries.length
  };

  const typeAdjustments: Record<FeedbackResourceType, number> = {
    skills: 0,
    tools: 0,
    presets: 0
  };

  for (const resourceType of ["skills", "tools", "presets"] as const) {
    const accepted = typeCounter[resourceType].accepted;
    const rejected = typeCounter[resourceType].rejected;
    const total = accepted + rejected;
    typeAdjustments[resourceType] = total >= minSamples ? toAdjustment(accepted, rejected) : 0;
  }

  return {
    updatedAt: new Date().toISOString(),
    minSamples,
    totals,
    typeAdjustments,
    resources
  };
}

export async function saveProposalFeedbackModel(modelFilePath: string, model: ProposalFeedbackModel): Promise<void> {
  await fsPromises.mkdir(dirname(modelFilePath), { recursive: true });
  await fsPromises.writeFile(modelFilePath, JSON.stringify(model, null, 2), "utf-8");
}

export async function loadProposalFeedbackModel(modelFilePath: string): Promise<ProposalFeedbackModel | null> {
  if (!existsSync(modelFilePath)) {
    return null;
  }

  try {
    const raw = await fsPromises.readFile(modelFilePath, "utf-8");
    const parsed = JSON.parse(raw) as ProposalFeedbackModel;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.resources)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function applyProposalFeedbackScore(
  baseScore: number,
  resourceType: FeedbackResourceType,
  resourceName: string,
  model: ProposalFeedbackModel | null
): number {
  if (!model) return baseScore;

  const resourceAdjustment = model.resources.find(
    (row) => row.resourceType === resourceType && row.name === resourceName
  )?.adjustment ?? 0;
  const typeAdjustment = model.typeAdjustments[resourceType] ?? 0;

  const multiplier = clamp(1 + resourceAdjustment + typeAdjustment * 0.5, 0.5, 1.5);
  return baseScore * multiplier;
}
