import type { SystemEventRecord } from "../../../event/system-event-manager.js";
import type { ObservabilityEvent, ObservabilityTrace } from "../../../observability/dashboard.js";

interface TraceProjectionInput {
  traceId: string;
  toolName: string;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  status: "running" | "success" | "error";
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}

export function projectObservabilityTraces(
  traces: TraceProjectionInput[]
): ObservabilityTrace[] {
  return traces.map((t) => ({
    traceId: t.traceId,
    toolName: t.toolName,
    startedAt: t.startedAt,
    endedAt: t.endedAt,
    durationMs: t.durationMs,
    status: t.status,
    errorMessage: t.errorMessage,
    metadata: t.metadata
  }));
}

export function projectObservabilityEvents(events: SystemEventRecord[]): ObservabilityEvent[] {
  return events.map((e) => ({
    id: e.id,
    event: e.event,
    timestamp: e.timestamp,
    payload: e.payload
  }));
}