import {
  appendProposalFeedback,
  buildProposalFeedbackModel,
  loadProposalFeedbackLog,
  saveProposalFeedbackModel
} from "../../../resource/proposal-feedback.js";
import {
  appendQuerySkillFeedback,
  buildQuerySkillIncrementalModel,
  QUERY_SKILL_MODEL_VERSION,
  loadQuerySkillFeedbackLog,
  saveQuerySkillIncrementalModel
} from "../../../resource/query-skill-incremental.js";

export type ProposalFeedbackDecision =
  | "accepted"
  | "rejected"
  | "reject_inaccurate"
  | "reject_unnecessary"
  | "reject_duplicate";

export interface ProposalFeedbackEntryInput {
  resourceType: "skills" | "tools" | "presets";
  name: string;
  decision: ProposalFeedbackDecision;
  topic?: string;
  note?: string;
  recordedAt?: string;
}

export async function executeProposalFeedbackLearn(args: {
  feedback: ProposalFeedbackEntryInput[];
  minSamples?: number;
  proposalFeedbackLog: string;
  proposalFeedbackModel: string;
  querySkillFeedbackLog: string;
  querySkillModel: string;
}): Promise<Record<string, unknown>> {
  const now = new Date().toISOString();
  const normalizedEntries = args.feedback.map((entry) => ({
    resourceType: entry.resourceType,
    name: entry.name,
    decision: entry.decision,
    topic: entry.topic,
    note: entry.note,
    recordedAt: entry.recordedAt ?? now
  }));

  await appendProposalFeedback(args.proposalFeedbackLog, normalizedEntries);
  const allEntries = await loadProposalFeedbackLog(args.proposalFeedbackLog);
  const effectiveMinSamples = args.minSamples ?? 3;
  const model = buildProposalFeedbackModel(allEntries, effectiveMinSamples);
  await saveProposalFeedbackModel(args.proposalFeedbackModel, model);

  const querySkillEntries = normalizedEntries
    .filter((entry) => entry.resourceType === "skills" && typeof entry.topic === "string" && entry.topic.trim().length > 0)
    .map((entry) => ({
      query: entry.topic!.trim(),
      skill: entry.name,
      decision: (entry.decision === "accepted" ? "accepted" : "rejected") as "accepted" | "rejected",
      recordedAt: entry.recordedAt
    }));
  if (querySkillEntries.length > 0) {
    await appendQuerySkillFeedback(args.querySkillFeedbackLog, querySkillEntries);
  }

  const allQuerySkillEntries = await loadQuerySkillFeedbackLog(args.querySkillFeedbackLog);
  const querySkillIncrementalModel = buildQuerySkillIncrementalModel(allQuerySkillEntries);
  await saveQuerySkillIncrementalModel(args.querySkillModel, querySkillIncrementalModel);

  return {
    saved: true,
    logFile: args.proposalFeedbackLog,
    modelFile: args.proposalFeedbackModel,
    newFeedbackCount: normalizedEntries.length,
    totalFeedbackCount: model.totals.total,
    totals: model.totals,
    typeAdjustments: model.typeAdjustments,
    topLearnedResources: model.resources.slice(0, 20),
    querySkillModelVersion: QUERY_SKILL_MODEL_VERSION,
    querySkillLogFile: args.querySkillFeedbackLog,
    querySkillModelFile: args.querySkillModel,
    querySkillFeedbackCount: allQuerySkillEntries.length,
    topLearnedQuerySkills: querySkillIncrementalModel.skills.slice(0, 20)
  };
}