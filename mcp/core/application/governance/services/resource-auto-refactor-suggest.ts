import { resolve } from "node:path";
import { promises as fsPromises } from "node:fs";
import type { ProposalQueueStore } from "../../../resource/proposal/proposal-queue-store.js";
import {
  getDefaultSchedulesFilePath,
  getDueAutoRefactorSchedules,
  loadCleanupSchedules
} from "../../../resource/cleanup-scheduler.js";
import { getDeclinedSkills, loadSkillRatings } from "../../../resource/skill-rating.js";
import { suggestRefactors } from "../../../../tools/refactor-suggest.js";

export async function executeAutoRefactorSuggest(args: {
  declineThreshold?: number;
  days?: number;
  limit?: number;
  respectSchedule?: boolean;
  at?: string;
  outputsDir: string;
  skillRatingLogFile: string;
  proposalQueue: ProposalQueueStore;
  emitSystemEvent: (event: string, payload: Record<string, unknown>) => Promise<void>;
}): Promise<Record<string, unknown>> {
  const now = args.at ? new Date(args.at) : new Date();
  const useSchedule = args.respectSchedule !== false;
  const schedulePath = getDefaultSchedulesFilePath(resolve("."));
  const schedules = await loadCleanupSchedules(schedulePath);
  const dueRefactorSchedules = getDueAutoRefactorSchedules(schedules, now);

  if (useSchedule && dueRefactorSchedules.length === 0) {
    return {
      executed: false,
      reason: "no due auto-refactor schedule",
      evaluatedAt: now.toISOString(),
      schedulePath,
      dueCount: 0
    };
  }

  const entries = await loadSkillRatings(args.skillRatingLogFile);
  const threshold = args.declineThreshold ?? 0.15;
  const windowDays = args.days ?? 14;
  const maxItems = args.limit ?? 10;
  const declined = getDeclinedSkills(entries, threshold, windowDays, now).slice(0, maxItems);

  const results: Array<{
    skill: string;
    proposalId: string;
    confidence: number;
    delta: number;
    suggestionCount: number;
  }> = [];

  for (const row of declined) {
    const skillPathCandidates = [
      resolve("skills", `${row.skill}.md`),
      resolve("skills", row.skill)
    ];

    let source = "";
    let filePath: string | undefined;
    for (const candidate of skillPathCandidates) {
      try {
        source = await fsPromises.readFile(candidate, "utf-8");
        filePath = candidate;
        break;
      } catch {
        // ignore and try next
      }
    }

    if (source.length === 0) {
      source = `// skill: ${row.skill}\n// No local source file was found.\n`;
    }

    const refactor = suggestRefactors({
      source,
      filePath
    });

    const confidence = Math.max(0, Math.min(1, Number((Math.abs(row.delta)).toFixed(3))));
    const content = [
      `# Auto Refactor Suggestion: ${row.skill}`,
      "",
      `- previousAcceptRate: ${row.previousAcceptRate}`,
      `- currentAcceptRate: ${row.currentAcceptRate}`,
      `- delta: ${row.delta}`,
      `- previousCount: ${row.previousCount}`,
      `- currentCount: ${row.currentCount}`,
      `- analyzedAt: ${now.toISOString()}`,
      "",
      "## refactor_suggest result",
      "```json",
      JSON.stringify(refactor, null, 2),
      "```"
    ].join("\n");

    const record = await args.proposalQueue.enqueue({
      resourceType: "skills",
      name: row.skill,
      content,
      confidence,
      sourceEvent: "skill_accept_rate_declined",
      origin: "auto-refactor"
    });

    results.push({
      skill: row.skill,
      proposalId: record.id,
      confidence,
      delta: row.delta,
      suggestionCount: refactor.totalSuggestions
    });
  }

  if (results.length > 0) {
    await args.emitSystemEvent("auto_refactor_suggested", {
      source: "auto_refactor_suggest",
      evaluatedAt: now.toISOString(),
      declineThreshold: threshold,
      windowDays,
      proposalCount: results.length,
      proposals: results
    });
  }

  return {
    executed: true,
    evaluatedAt: now.toISOString(),
    declineThreshold: threshold,
    days: windowDays,
    respectedSchedule: useSchedule,
    dueScheduleCount: dueRefactorSchedules.length,
    scannedRatings: entries.length,
    declinedSkillCount: declined.length,
    proposals: results
  };
}