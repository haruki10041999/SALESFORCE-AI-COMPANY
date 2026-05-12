import { z } from "zod";
import { executeDrillDownDashboardTool } from "../../core/application/analytics/services/analytics-drill-down-tool.js";
import { getCompletedTraces, getActiveTraces } from "../../core/trace/trace-context.js";
import type { RegisterGovToolDeps } from "../types.js";

export interface DefineDrillDownDashboardDeps extends RegisterGovToolDeps {
  loadSystemEvents: any;
}

export function defineDrillDownDashboardTool(deps: DefineDrillDownDashboardDeps): void {
  const { govTool, loadSystemEvents } = deps;

  govTool(
    "drill_down_dashboard",
    {
      title: "ダッシュボード drill-down",
      description: "特定ツール / ステータス / 期間で trace と event を絞り込み、詳細と集計を返します。",
      inputSchema: {
        toolName: z.string().optional(),
        status: z.enum(["running", "success", "error"]).optional(),
        since: z.string().optional(),
        until: z.string().optional(),
        eventType: z.string().optional(),
        eventLimit: z.number().int().min(50).max(5000).optional(),
        traceLimit: z.number().int().min(10).max(5000).optional(),
        limit: z.number().int().min(1).max(500).optional()
      }
    },
    async ({
      toolName,
      status,
      since,
      until,
      eventType,
      eventLimit,
      traceLimit,
      limit
    }: {
      toolName?: string;
      status?: "running" | "success" | "error";
      since?: string;
      until?: string;
      eventType?: string;
      eventLimit?: number;
      traceLimit?: number;
      limit?: number;
    }) => {
      const content = await executeDrillDownDashboardTool({
        toolName,
        status,
        since,
        until,
        eventType,
        eventLimit,
        traceLimit,
        limit,
        getCompletedTraces,
        getActiveTraces,
        loadSystemEvents
      });
      return { content };
    }
  );
}
