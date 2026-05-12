import { z } from "zod";
import { join, resolve } from "node:path";
import { getOutputsDir, getPrimaryDatabaseUrl } from "../../core/config/runtime-config.js";
import type { RegisterGovToolDeps } from "../types.js";
import { OutputsArtifactWriter } from "../../core/persistence/outputs-artifact-writer.js";
import {
  executeGetSkillRatingReport
} from "../../core/application/resource/services/resource-search-operations.js";

export interface DefineGetSkillRatingReportDeps extends RegisterGovToolDeps {
  // No additional deps beyond govTool
}

export function defineGetSkillRatingReportTool(deps: DefineGetSkillRatingReportDeps): void {
  const { govTool } = deps;

  const outputsDir = resolve(getOutputsDir());
  const skillRatingLogFile = join(outputsDir, "reports", "skill-rating.jsonl");
  const skillRatingModelFile = join(outputsDir, "reports", "skill-rating.json");
  const skillRatingReportFile = join(outputsDir, "reports", "skill-rating.md");
  const artifactWriter = new OutputsArtifactWriter({
    outputsDir,
    databaseUrl: getPrimaryDatabaseUrl()
  });

  govTool(
    "get_skill_rating_report",
    {
      title: "スキル満足度レポート取得",
      description: "記録済みレーティングから評価レポートを再生成して返します。",
      inputSchema: z.object({
        recentWindow: z.number().int().min(1).max(30).optional(),
        lowRatingThreshold: z.number().min(1).max(5).optional(),
        trendDropThreshold: z.number().min(0).max(5).optional(),
        maxSkills: z.number().int().min(1).max(200).optional()
      })
    },
    async ({ recentWindow, lowRatingThreshold, trendDropThreshold, maxSkills }: {
      recentWindow?: number;
      lowRatingThreshold?: number;
      trendDropThreshold?: number;
      maxSkills?: number;
    }) => {
      const payload = await executeGetSkillRatingReport({
        recentWindow,
        lowRatingThreshold,
        trendDropThreshold,
        maxSkills,
        skillRatingLogFile,
        skillRatingModelFile,
        skillRatingReportFile,
        writeReportMarkdown: async (markdown) => artifactWriter.writeText("reports/skill-rating.md", markdown)
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(payload, null, 2)
          }
        ]
      };
    }
  );
}
