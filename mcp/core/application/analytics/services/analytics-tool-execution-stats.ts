import type { SystemEventRecord } from "../../../event/system-event-manager.js";
import {
  aggregateToolAfterExecuteEvents,
  type ToolExecutionAggregate
} from "./analytics-event-insights.js";

export interface ToolExecutionWindowSummary {
  windowMinutes: number;
  sampledEvents: number;
  totals: ToolExecutionAggregate["totals"];
  rates: ToolExecutionAggregate["rates"];
}

export interface ToolExecutionTimelineBucket {
  bucketStart: string;
  bucketMinutes: number;
  totals: ToolExecutionAggregate["totals"];
  rates: ToolExecutionAggregate["rates"];
}

export interface ToolExecutionStatisticsSummary {
  windowMinutes: number;
  sampledEvents: number;
  totals: ToolExecutionAggregate["totals"];
  rates: ToolExecutionAggregate["rates"];
  perTool: ToolExecutionAggregate["perTool"];
  windows: ToolExecutionWindowSummary[];
  timeline: ToolExecutionTimelineBucket[];
}

export function buildToolExecutionStatisticsSummary(params: {
  events: SystemEventRecord[];
  windowMinutes?: number;
  windowsMinutes?: number[];
  bucketMinutes?: number;
  nowMs?: number;
}): ToolExecutionStatisticsSummary {
  const nowMs = params.nowMs ?? Date.now();
  const primaryWindowMinutes = params.windowMinutes ?? 60;
  const primaryWindowMs = primaryWindowMinutes * 60 * 1000;
  const relevantEvents = params.events.filter((event) => {
    const ts = Date.parse(event.timestamp ?? "");
    return Number.isFinite(ts) && nowMs - ts <= primaryWindowMs;
  });
  const aggregate = aggregateToolAfterExecuteEvents(relevantEvents);

  const windowCandidates = params.windowsMinutes && params.windowsMinutes.length > 0
    ? params.windowsMinutes
    : [60, 24 * 60, 7 * 24 * 60];
  const normalizedWindows = [...new Set(windowCandidates)].sort((a, b) => a - b);
  const windows = normalizedWindows.map((minutes) => {
    const cutoff = nowMs - minutes * 60 * 1000;
    const scopedEvents = params.events.filter((event) => {
      const ts = Date.parse(event.timestamp ?? "");
      return Number.isFinite(ts) && ts >= cutoff;
    });
    const scopedAggregate = aggregateToolAfterExecuteEvents(scopedEvents);
    return {
      windowMinutes: minutes,
      sampledEvents: scopedEvents.length,
      totals: scopedAggregate.totals,
      rates: scopedAggregate.rates
    };
  });

  const bucketSizeMinutes = params.bucketMinutes ?? 60;
  const bucketSizeMs = bucketSizeMinutes * 60 * 1000;
  const timelineBuckets = new Map<number, SystemEventRecord[]>();
  for (const event of relevantEvents) {
    const ts = Date.parse(event.timestamp ?? "");
    if (!Number.isFinite(ts)) {
      continue;
    }
    const bucketStart = Math.floor(ts / bucketSizeMs) * bucketSizeMs;
    const bucketEvents = timelineBuckets.get(bucketStart) ?? [];
    bucketEvents.push(event);
    timelineBuckets.set(bucketStart, bucketEvents);
  }

  const timeline = [...timelineBuckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([bucketStart, bucketEvents]) => {
      const scopedAggregate = aggregateToolAfterExecuteEvents(bucketEvents);
      return {
        bucketStart: new Date(bucketStart).toISOString(),
        bucketMinutes: bucketSizeMinutes,
        totals: scopedAggregate.totals,
        rates: scopedAggregate.rates
      };
    });

  return {
    windowMinutes: primaryWindowMinutes,
    sampledEvents: relevantEvents.length,
    totals: aggregate.totals,
    rates: aggregate.rates,
    perTool: aggregate.perTool,
    windows,
    timeline
  };
}