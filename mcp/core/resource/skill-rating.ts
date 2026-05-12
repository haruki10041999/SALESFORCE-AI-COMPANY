import { existsSync, promises as fsPromises } from "node:fs";
import { dirname } from "node:path";
import { getAnalyticsStore } from "../persistence/analytics-store-provider.js";
import { appendTextFileAtomic, writeTextFileAtomic } from "../persistence/unit-of-work.js";

export type SkillRatingEntry = {
  skill: string;
  rating: number;
  topic?: string;
  note?: string;
  recordedAt: string;
};

export type SkillRatingStats = {
  skill: string;
  count: number;
  averageRating: number;
  recentAverageRating: number;
  previousAverageRating: number | null;
  trendDelta: number;
  latestRecordedAt: string | null;
  flaggedForRefactor: boolean;
};

export type SkillRatingModel = {
  updatedAt: string;
  params: {
    recentWindow: number;
    lowRatingThreshold: number;
    trendDropThreshold: number;
  };
  totals: {
    count: number;
    averageRating: number;
  };
  skills: SkillRatingStats[];
};

export type DeclinedSkill = {
  skill: string;
  previousAcceptRate: number;
  currentAcceptRate: number;
  delta: number;
  previousCount: number;
  currentCount: number;
  latestRecordedAt: string | null;
};

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sum = values.reduce((acc, row) => acc + row, 0);
  return Number((sum / values.length).toFixed(3));
}

function safeDate(input: string): number {
  const parsed = Date.parse(input);
  return Number.isFinite(parsed) ? parsed : 0;
}

function acceptedFromRating(rating: number): boolean {
  return rating >= 4;
}

function acceptRate(entries: SkillRatingEntry[]): number {
  if (entries.length === 0) return 0;
  const accepted = entries.reduce((acc, entry) => acc + (acceptedFromRating(entry.rating) ? 1 : 0), 0);
  return Number((accepted / entries.length).toFixed(3));
}

export function getDeclinedSkills(
  entries: SkillRatingEntry[],
  threshold: number,
  days: number,
  now: Date = new Date()
): DeclinedSkill[] {
  const effectiveThreshold = Math.max(0, Math.min(1, Number(threshold)));
  const effectiveDays = Math.max(1, Math.min(180, Math.floor(days)));
  const dayMs = 24 * 60 * 60 * 1000;
  const currentStart = now.getTime() - effectiveDays * dayMs;
  const previousStart = currentStart - effectiveDays * dayMs;

  const bySkill = new Map<string, SkillRatingEntry[]>();
  for (const entry of entries) {
    const rows = bySkill.get(entry.skill) ?? [];
    rows.push(entry);
    bySkill.set(entry.skill, rows);
  }

  const declined: DeclinedSkill[] = [];
  for (const [skill, rows] of bySkill.entries()) {
    const currentRows = rows.filter((entry) => {
      const ts = safeDate(entry.recordedAt);
      return ts >= currentStart && ts <= now.getTime();
    });
    const previousRows = rows.filter((entry) => {
      const ts = safeDate(entry.recordedAt);
      return ts >= previousStart && ts < currentStart;
    });

    if (currentRows.length === 0 || previousRows.length === 0) {
      continue;
    }

    const currentAcceptRate = acceptRate(currentRows);
    const previousAcceptRate = acceptRate(previousRows);
    const delta = Number((currentAcceptRate - previousAcceptRate).toFixed(3));

    if (delta <= -effectiveThreshold) {
      const latestRecordedAt = [...rows]
        .sort((a, b) => safeDate(a.recordedAt) - safeDate(b.recordedAt))
        .at(-1)?.recordedAt ?? null;
      declined.push({
        skill,
        previousAcceptRate,
        currentAcceptRate,
        delta,
        previousCount: previousRows.length,
        currentCount: currentRows.length,
        latestRecordedAt
      });
    }
  }

  return declined.sort((a, b) => a.delta - b.delta);
}

export async function appendSkillRatings(logFilePath: string, entries: SkillRatingEntry[]): Promise<void> {
  if (entries.length === 0) {
    return;
  }
  const analyticsStore = await getAnalyticsStore();
  if (analyticsStore) {
    await analyticsStore.appendSkillRatingEntries(entries);
    return;
  }
  await fsPromises.mkdir(dirname(logFilePath), { recursive: true });
  const lines = entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
  await appendTextFileAtomic(logFilePath, lines);
}

export async function loadSkillRatings(logFilePath: string): Promise<SkillRatingEntry[]> {
  const analyticsStore = await getAnalyticsStore();
  if (analyticsStore) {
    return analyticsStore.listSkillRatingEntries();
  }
  if (!existsSync(logFilePath)) {
    return [];
  }

  const raw = await fsPromises.readFile(logFilePath, "utf-8");
  const rows: SkillRatingEntry[] = [];
  for (const line of raw.split(/\r?\n/).map((value) => value.trim()).filter((value) => value.length > 0)) {
    try {
      const parsed = JSON.parse(line) as SkillRatingEntry;
      const rating = Math.floor(Number(parsed.rating));
      if (typeof parsed.skill !== "string" || parsed.skill.trim().length === 0) {
        continue;
      }
      if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
        continue;
      }
      if (typeof parsed.recordedAt !== "string" || parsed.recordedAt.trim().length === 0) {
        continue;
      }
      const entry: SkillRatingEntry = {
        skill: parsed.skill.trim(),
        rating,
        recordedAt: parsed.recordedAt
      };
      if (typeof parsed.topic === "string") {
        entry.topic = parsed.topic;
      }
      if (typeof parsed.note === "string") {
        entry.note = parsed.note;
      }
      rows.push(entry);
    } catch {
      // ignore broken lines
    }
  }
  return rows;
}

export function buildSkillRatingModel(
  entries: SkillRatingEntry[],
  recentWindow: number,
  lowRatingThreshold: number,
  trendDropThreshold: number
): SkillRatingModel {
  const effectiveRecentWindow = Math.max(1, Math.min(30, Math.floor(recentWindow)));
  const effectiveLowRatingThreshold = Math.max(1, Math.min(5, Number(lowRatingThreshold)));
  const effectiveTrendDropThreshold = Math.max(0, Math.min(5, Number(trendDropThreshold)));

  const bySkill = new Map<string, SkillRatingEntry[]>();
  for (const entry of entries) {
    const rows = bySkill.get(entry.skill) ?? [];
    rows.push(entry);
    bySkill.set(entry.skill, rows);
  }

  const skills: SkillRatingStats[] = [...bySkill.entries()].map(([skill, rows]) => {
    const sorted = [...rows].sort((a, b) => safeDate(a.recordedAt) - safeDate(b.recordedAt));
    const ratings = sorted.map((row) => row.rating);
    const recentRatings = ratings.slice(-effectiveRecentWindow);
    const prevWindowSize = Math.min(effectiveRecentWindow, Math.max(0, ratings.length - recentRatings.length));
    const previousRatings = prevWindowSize > 0
      ? ratings.slice(-(recentRatings.length + prevWindowSize), -recentRatings.length)
      : [];

    const averageRating = average(ratings);
    const recentAverageRating = average(recentRatings);
    const previousAverageRating = previousRatings.length > 0 ? average(previousRatings) : null;
    const trendDelta = Number((recentAverageRating - (previousAverageRating ?? recentAverageRating)).toFixed(3));

    return {
      skill,
      count: ratings.length,
      averageRating,
      recentAverageRating,
      previousAverageRating,
      trendDelta,
      latestRecordedAt: sorted[sorted.length - 1]?.recordedAt ?? null,
      flaggedForRefactor:
        recentAverageRating < effectiveLowRatingThreshold ||
        (previousAverageRating !== null && trendDelta <= -effectiveTrendDropThreshold)
    };
  });

  skills.sort((a, b) => {
    if (a.flaggedForRefactor !== b.flaggedForRefactor) {
      return a.flaggedForRefactor ? -1 : 1;
    }
    if (b.count !== a.count) {
      return b.count - a.count;
    }
    if (a.averageRating !== b.averageRating) {
      return a.averageRating - b.averageRating;
    }
    return a.skill.localeCompare(b.skill);
  });

  return {
    updatedAt: new Date().toISOString(),
    params: {
      recentWindow: effectiveRecentWindow,
      lowRatingThreshold: effectiveLowRatingThreshold,
      trendDropThreshold: effectiveTrendDropThreshold
    },
    totals: {
      count: entries.length,
      averageRating: average(entries.map((row) => row.rating))
    },
    skills
  };
}

export async function saveSkillRatingModel(modelFilePath: string, model: SkillRatingModel): Promise<void> {
  const analyticsStore = await getAnalyticsStore();
  if (analyticsStore) {
    await analyticsStore.saveNamedModel("skill-rating-model", model as unknown as Record<string, unknown>);
    return;
  }
  await fsPromises.mkdir(dirname(modelFilePath), { recursive: true });
  await writeTextFileAtomic(modelFilePath, JSON.stringify(model, null, 2));
}

export function renderSkillRatingMarkdown(model: SkillRatingModel): string {
  const lines: string[] = [];
  lines.push("# Skill Rating Report");
  lines.push("");
  lines.push(`- updatedAt: ${model.updatedAt}`);
  lines.push(`- totalRatings: ${model.totals.count}`);
  lines.push(`- overallAverage: ${model.totals.averageRating}`);
  lines.push(`- recentWindow: ${model.params.recentWindow}`);
  lines.push(`- lowRatingThreshold: ${model.params.lowRatingThreshold}`);
  lines.push(`- trendDropThreshold: ${model.params.trendDropThreshold}`);
  lines.push("");

  if (model.skills.length === 0) {
    lines.push("No skill ratings recorded yet.");
    return lines.join("\n");
  }

  lines.push("| skill | count | avg | recentAvg | prevAvg | trendDelta | flaggedForRefactor |");
  lines.push("|---|---:|---:|---:|---:|---:|---|");
  for (const row of model.skills) {
    lines.push(
      `| ${row.skill} | ${row.count} | ${row.averageRating.toFixed(2)} | ${row.recentAverageRating.toFixed(2)} | ${row.previousAverageRating === null ? "-" : row.previousAverageRating.toFixed(2)} | ${row.trendDelta.toFixed(2)} | ${row.flaggedForRefactor ? "yes" : "no"} |`
    );
  }

  return lines.join("\n");
}