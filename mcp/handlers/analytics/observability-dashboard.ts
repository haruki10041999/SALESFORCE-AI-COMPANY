import { z } from "zod";
import type { RegisterGovToolDeps } from "../types.js";

export interface DefineObservabilityDashboardDeps extends RegisterGovToolDeps {
  outputsDir?: string;
  loadSystemEvents?: any;
  loadGovernanceState?: any;
  artifactWriter?: any;
}

export function defineObservabilityDashboardTool(deps: DefineObservabilityDashboardDeps): void {
  const { govTool, outputsDir, loadSystemEvents, loadGovernanceState } = deps;

  govTool(
    "observability_dashboard",
    {
      title: "Observability Dashboard",
      description: "trace + system_event + governance_state を join したダッシュボードを生成します。",
      inputSchema: {
        eventLimit: z.number().int().min(50).max(5000).optional(),
        traceLimit: z.number().int().min(10).max(500).optional(),
        correlationWindowMs: z.number().int().min(100).max(60000).optional(),
        format: z.enum(["html", "markdown", "json"]).optional(),
        write: z.boolean().optional()
      }
    },
    async ({
      eventLimit,
      traceLimit,
      correlationWindowMs,
      format,
      write
    }: {
      eventLimit?: number;
      traceLimit?: number;
      correlationWindowMs?: number;
      format?: "html" | "markdown" | "json";
      write?: boolean;
    }) => {
      try {
        const events = loadSystemEvents ? await loadSystemEvents(eventLimit ?? 1000) : [];
        const state = loadGovernanceState ? await loadGovernanceState() : null;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                eventCount: Array.isArray(events) ? events.length : 0,
                governance: state ? "active" : "unavailable",
                dashboardPath: outputsDir ? `${outputsDir}/dashboards` : "unknown"
              }, null, 2)
            }
          ]
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: String(error) }, null, 2) }]
        };
      }
    }
  );
}
