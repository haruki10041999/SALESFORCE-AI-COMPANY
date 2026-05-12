import { z } from "zod";
import { recommendSkillsForRole } from "../../tools/recommend-skills-for-role.js";
import type { RegisterGovToolDeps } from "../types.js";

export interface DefineRecommendSkillsForRoleDeps extends RegisterGovToolDeps {
  listSkillsWithSummary?: () => Array<{ name: string; summary: string }>;
}

export function defineRecommendSkillsForRoleTool(deps: DefineRecommendSkillsForRoleDeps): void {
  const { govTool, listSkillsWithSummary } = deps;

  govTool(
    "recommend_skills_for_role",
    {
      title: "コンテクスト連動スキル推薦",
      description: "役割 / トピック / 直近の変更ファイルから関連スキルをスコアリングして返します。",
      inputSchema: {
        role: z.string().optional(),
        topic: z.string().optional(),
        recentFiles: z.array(z.string()).optional(),
        limit: z.number().int().min(1).max(50).optional()
      }
    },
    async ({ role, topic, recentFiles, limit }: {
      role?: string;
      topic?: string;
      recentFiles?: string[];
      limit?: number;
    }) => {
      const skills = listSkillsWithSummary ? listSkillsWithSummary() : [];
      const result = recommendSkillsForRole({ role, topic, recentFiles, limit, skills });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );
}
