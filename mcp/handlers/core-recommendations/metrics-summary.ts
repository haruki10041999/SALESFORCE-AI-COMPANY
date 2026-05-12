import { z } from "zod";
import { summarizeMetrics } from "../../tools/metrics-summary.js";
import type { RegisterGovToolDeps } from "../types.js";

export interface DefineMetricsSummaryDeps extends RegisterGovToolDeps {}

export function defineMetricsSummaryTool(deps: DefineMetricsSummaryDeps): void {
  const { govTool } = deps;

  govTool(
    "metrics_summary",
    {
      title: "メトリクス要約",
      description: "トレース履歴から最近のツール実行メトリクスを要約します。tool 別 SLA 閾値も指定可能です。",
      inputSchema: {
        limit: z.number().int().min(1).max(1000).optional(),
        maxP95Ms: z.number().int().positive().optional(),
        maxErrorRatePercent: z.number().min(0).max(100).optional(),
        toolSlaThresholds: z.record(
          z.string(),
          z.object({
            maxP95Ms: z.number().int().positive().optional(),
            maxErrorRatePercent: z.number().min(0).max(100).optional()
          })
        ).optional()
      }
    },
    async ({
      limit,
      maxP95Ms,
      maxErrorRatePercent,
      toolSlaThresholds
    }: {
      limit?: number;
      maxP95Ms?: number;
      maxErrorRatePercent?: number;
      toolSlaThresholds?: Record<string, { maxP95Ms?: number; maxErrorRatePercent?: number }>;
    }) => {
      const result = summarizeMetrics({ limit, maxP95Ms, maxErrorRatePercent, toolSlaThresholds });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );
}
