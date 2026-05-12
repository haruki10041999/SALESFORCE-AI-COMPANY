import type { SystemEventRecord } from "../../../event/system-event-manager.js";
import { drillDownDashboard } from "../../../observability/dashboard-drill-down.js";
import {
  buildDrillDownDashboardResponse
} from "./analytics-dashboard-responses.js";
import { buildDrillDownMarkdown } from "./analytics-markdown.js";
import {
  projectObservabilityEvents,
  projectObservabilityTraces
} from "./analytics-observability-projections.js";

type TraceProjectionInput = {
  traceId: string;
  toolName: string;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  status: "running" | "success" | "error";
  errorMessage?: string;
  metadata?: Record<string, unknown>;
};

export async function executeDrillDownDashboardTool(args: {
  toolName?: string;
  status?: "running" | "success" | "error";
  since?: string;
  until?: string;
  eventType?: string;
  eventLimit?: number;
  traceLimit?: number;
  limit?: number;
  getCompletedTraces: (limit: number) => TraceProjectionInput[];
  getActiveTraces: () => TraceProjectionInput[];
  loadSystemEvents: (limit?: number, event?: string) => Promise<SystemEventRecord[]>;
}): Promise<Array<{ type: "text"; text: string }>> {
  const traces = projectObservabilityTraces([
    ...args.getCompletedTraces(args.traceLimit ?? 200),
    ...args.getActiveTraces()
  ]);
  const events = projectObservabilityEvents(await args.loadSystemEvents(args.eventLimit ?? 1000));

  const result = drillDownDashboard(traces, events, {
    toolName: args.toolName,
    status: args.status,
    since: args.since,
    until: args.until,
    eventType: args.eventType,
    limit: args.limit
  });

  const markdown = buildDrillDownMarkdown({
    toolName: args.toolName,
    status: args.status,
    aggregates: result.aggregates
  });

  return buildDrillDownDashboardResponse({
    result,
    markdown
  });
}
