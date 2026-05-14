import { z } from "zod";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RegisterGovToolDeps } from "../types.js";
import { getCompletedTraces } from "../../core/trace/trace-context.js";
import { buildObservabilityDashboard } from "../../core/observability/dashboard.js";
import { loadLearningPromotionHistory } from "../../contexts/learning/index.js";

export interface DefineObservabilityDashboardDeps extends RegisterGovToolDeps {
  outputsDir?: string;
  loadSystemEvents?: (limit?: number) => Promise<Array<{
    id: string;
    event: string;
    timestamp: string;
    payload: Record<string, unknown>;
  }>>;
  loadGovernanceState?: () => Promise<{
    disabled?: Record<string, string[]>;
    lifecycle?: Record<string, Record<string, string>>;
  } | null>;
}

function extractGovernanceFlagged(state: {
  disabled?: Record<string, string[]>;
  lifecycle?: Record<string, Record<string, string>>;
} | null | undefined): Array<{ resourceType: "skills" | "tools" | "presets"; name: string; reason: string }> {
  if (!state) {
    return [];
  }

  const flagged = new Map<string, { resourceType: "skills" | "tools" | "presets"; name: string; reason: string }>();
  const types: Array<"skills" | "tools" | "presets"> = ["skills", "tools", "presets"];

  for (const type of types) {
    const disabled = state.disabled?.[type] ?? [];
    for (const name of disabled) {
      flagged.set(`${type}:${name}`, {
        resourceType: type,
        name,
        reason: "disabled"
      });
    }

    const lifecycle = state.lifecycle?.[type] ?? {};
    for (const [name, lifecycleState] of Object.entries(lifecycle)) {
      if (lifecycleState === "deprecated" || lifecycleState === "disabled") {
        flagged.set(`${type}:${name}`, {
          resourceType: type,
          name,
          reason: `lifecycle:${lifecycleState}`
        });
      }
    }
  }

  return [...flagged.values()];
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
        promotionLimit: z.number().int().min(1).max(500).optional(),
        correlationWindowMs: z.number().int().min(100).max(60000).optional(),
        format: z.enum(["html", "markdown", "json"]).optional(),
        write: z.boolean().optional()
      }
    },
    async ({
      eventLimit,
      traceLimit,
      promotionLimit,
      correlationWindowMs,
      format,
      write
    }: {
      eventLimit?: number;
      traceLimit?: number;
      promotionLimit?: number;
      correlationWindowMs?: number;
      format?: "html" | "markdown" | "json";
      write?: boolean;
    }) => {
      try {
        const events = loadSystemEvents ? await loadSystemEvents(eventLimit ?? 1000) : [];
        const state = loadGovernanceState ? await loadGovernanceState() : null;
        const traces = getCompletedTraces(traceLimit ?? 50);
        const governanceFlagged = extractGovernanceFlagged(state);
        const learningPromotions = outputsDir
          ? await loadLearningPromotionHistory(join(outputsDir, "learning", "promotion-history.jsonl"), promotionLimit ?? 100)
          : [];

        const report = buildObservabilityDashboard({
          traces,
          events,
          governanceFlagged,
          learningPromotions,
          correlationWindowMs,
          recentLimit: traceLimit
        });

        const outputFormat = format ?? "json";
        const rendered = outputFormat === "html"
          ? report.html
          : outputFormat === "markdown"
            ? report.markdown
            : JSON.stringify(report, null, 2);

        let writtenPath: string | undefined;
        if (write && outputsDir) {
          const dashboardsDir = join(outputsDir, "dashboards");
          await mkdir(dashboardsDir, { recursive: true });
          const ext = outputFormat === "json" ? "json" : outputFormat === "markdown" ? "md" : "html";
          writtenPath = join(dashboardsDir, `observability-dashboard.${ext}`);
          await writeFile(writtenPath, rendered, "utf-8");
        }

        return {
          content: [
            {
              type: "text",
              text: rendered
            },
            {
              type: "text",
              text: JSON.stringify({
                summary: report.summary,
                outputFormat,
                ...(writtenPath ? { writtenPath } : {})
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
