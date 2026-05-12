import { z } from "zod";
import type { RegisterGovToolDeps } from "../types.js";
import {
  buildProgressBanner,
  describeRecentTraces
} from "../../core/progress/progress-formatter.js";

export interface DefineGetToolProgressToolDeps extends RegisterGovToolDeps {}

export function defineGetToolProgressTool(deps: DefineGetToolProgressToolDeps): void {
  const { govTool } = deps;

  govTool(
    "get_tool_progress",
    {
      title: "ツール進捗取得",
      description: "進行中・直近完了したツール実行の trace 進捗 (フェーズ・所要時間) を Markdown で取得します。traceId を指定すると単一トレースの詳細を返します。",
      inputSchema: {
        traceId: z.string().optional(),
        recentLimit: z.number().int().min(1).max(100).optional()
      }
    },
    async ({ traceId, recentLimit }: { traceId?: string; recentLimit?: number }) => {
      if (traceId) {
        const banner = buildProgressBanner(traceId, {
          title: "進捗詳細",
          emitWhenEmpty: true
        });
        return {
          content: [{ type: "text", text: banner }]
        };
      }

      const summary = describeRecentTraces(recentLimit ?? 20);
      return {
        content: [{ type: "text", text: summary }]
      };
    }
  );
}
