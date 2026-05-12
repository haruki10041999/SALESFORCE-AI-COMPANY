import { z } from "zod";
import { buildToolExecutionStatisticsSummary } from "../../core/application/analytics/services/analytics-tool-execution-stats.js";
import { buildToolExecutionStatsMarkdown } from "../../core/application/analytics/services/analytics-markdown.js";
import type { RegisterGovToolDeps } from "../types.js";

export interface DefineGetToolExecutionStatisticsDeps extends RegisterGovToolDeps {
  loadSystemEvents: any;
  loadGovernanceState: any;
}

export function defineGetToolExecutionStatisticsTool(deps: DefineGetToolExecutionStatisticsDeps): void {
  const { govTool, loadSystemEvents, loadGovernanceState } = deps;

  govTool(
    "get_tool_execution_statistics",
    {
      title: "ツール実行統計取得",
      description: "ツール実行の統計情報を取得します。",
      inputSchema: {
        windowMinutes: z.number().int().min(1).max(7 * 24 * 60).optional(),
        windowsMinutes: z.array(z.number().int().min(1).max(7 * 24 * 60)).max(10).optional(),
        bucketMinutes: z.number().int().min(5).max(180).optional(),
        limit: z.number().int().min(10).max(2000).optional()
      }
    },
    async ({ windowMinutes, windowsMinutes, bucketMinutes, limit }: {
      windowMinutes?: number;
      windowsMinutes?: number[];
      bucketMinutes?: number;
      limit?: number;
    }) => {
      const eventLimit = limit ?? 1000;
      const events = await loadSystemEvents(eventLimit, "tool_after_execute");
      const summary = buildToolExecutionStatisticsSummary({
        events,
        windowMinutes,
        windowsMinutes,
        bucketMinutes
      });

      const governanceState = await loadGovernanceState();
      const disabledTools = Array.isArray(governanceState?.disabled?.tools) ? governanceState.disabled.tools : [];

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                windowMinutes: summary.windowMinutes,
                sampledEvents: summary.sampledEvents,
                totals: summary.totals,
                rates: summary.rates,
                disabledTools: { count: disabledTools.length, names: disabledTools },
                perTool: summary.perTool,
                windows: summary.windows,
                timeline: summary.timeline
              },
              null,
              2
            )
          },
          {
            type: "text",
            text: buildToolExecutionStatsMarkdown({
              windowMinutes: summary.windowMinutes,
              sampledEvents: summary.sampledEvents,
              totals: summary.totals,
              rates: summary.rates,
              disabledTools,
              perTool: summary.perTool
            })
          }
        ]
      };
    }
  );
}
