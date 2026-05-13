import { z } from "zod";
import { join, resolve } from "node:path";
import { getOutputsDir } from "../../core/config/runtime-config.js";
import type { RegisterGovToolDeps } from "../types.js";
import { LocalOutputsAdapter } from "../../infrastructure/outputs/local-outputs-adapter.js";
import {
  executeRecordSkillRating
} from "../../core/application/resource/services/resource-search-operations.js";

export interface DefineRecordSkillRatingDeps extends RegisterGovToolDeps {
  // No additional deps beyond govTool
}

export function defineRecordSkillRatingTool(deps: DefineRecordSkillRatingDeps): void {
  const { govTool } = deps;

  const outputsDir = resolve(getOutputsDir());
  const skillRatingLogFile = join(outputsDir, "reports", "skill-rating.jsonl");
  const skillRatingModelFile = join(outputsDir, "reports", "skill-rating.json");
  const skillRatingReportFile = join(outputsDir, "reports", "skill-rating.md");
  const outputsPort = new LocalOutputsAdapter({ outputsDir });

  govTool(
    "record_skill_rating",
    {
      title: "スキル満足度レーティング記録",
      description: "スキル利用後の満足度(1〜5)を記録し、平均評価とトレンドレポートを更新します。",
      inputSchema: z.object({
        ratings: z.array(z.object({
          skill: z.string(),
          rating: z.number().int().min(1).max(5),
          topic: z.string().optional(),
          note: z.string().optional(),
          recordedAt: z.string().optional()
        })).min(1).max(200),
        recentWindow: z.number().int().min(1).max(30).optional(),
        lowRatingThreshold: z.number().min(1).max(5).optional(),
        trendDropThreshold: z.number().min(0).max(5).optional()
      })
    },
    async ({ ratings, recentWindow, lowRatingThreshold, trendDropThreshold }: {
      ratings: Array<{
        skill: string;
        rating: number;
        topic?: string;
        note?: string;
        recordedAt?: string;
      }>;
      recentWindow?: number;
      lowRatingThreshold?: number;
      trendDropThreshold?: number;
    }) => {
      const payload = await executeRecordSkillRating({
        ratings,
        recentWindow,
        lowRatingThreshold,
        trendDropThreshold,
        skillRatingLogFile,
        skillRatingModelFile,
        skillRatingReportFile,
        writeReportMarkdown: async (markdown) => outputsPort.writeArtifact("reports/skill-rating.md", markdown, { contentType: "text/markdown" })
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
