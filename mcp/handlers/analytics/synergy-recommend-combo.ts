import { z } from "zod";
import { buildSynergyModel, recommendCombo, extractSynergyRecordsFromTraces } from "../../core/resource/synergy-model.js";
import { buildSynergyRecommendResponse, selectSynergyCandidates } from "../../core/application/analytics/services/analytics-synergy.js";
import { getCompletedTraces } from "../../core/trace/trace-context.js";
import type { RegisterGovToolDeps } from "../types.js";

export interface DefineSynergyRecommendComboDeps extends RegisterGovToolDeps {}

export function defineSynergyRecommendComboTool(deps: DefineSynergyRecommendComboDeps): void {
  const { govTool } = deps;

  govTool(
    "synergy_recommend_combo",
    {
      title: "Agent×Skill Synergy 推薦",
      description: "過去 trace から (agent, skill) 共起・成功率を学習し、相性 top-N の組合せを提案します。",
      inputSchema: {
        agents: z.array(z.string()).min(1).max(50).optional(),
        skills: z.array(z.string()).min(1).max(100).optional(),
        traceLimit: z.number().int().min(10).max(1000).optional(),
        limit: z.number().int().min(1).max(20).optional(),
        minScore: z.number().min(0).max(1).optional()
      }
    },
    async ({
      agents,
      skills,
      traceLimit,
      limit,
      minScore
    }: {
      agents?: string[];
      skills?: string[];
      traceLimit?: number;
      limit?: number;
      minScore?: number;
    }) => {
      const traces = getCompletedTraces(traceLimit ?? 200).map((t) => ({
        status: t.status,
        endedAt: t.endedAt,
        metadata: t.metadata
      }));

      const records = extractSynergyRecordsFromTraces(traces);
      const model = buildSynergyModel(records);

      const candidates = selectSynergyCandidates({ model, agents, skills });

      const combos = recommendCombo(model, {
        agents: candidates.agents,
        skills: candidates.skills,
        limit: limit ?? 5,
        minScore: minScore ?? 0
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              buildSynergyRecommendResponse({
                trainedFromTraces: records.length,
                pairsLearned: model.pairs.size,
                combos
              }),
              null,
              2
            )
          }
        ]
      };
    }
  );
}
