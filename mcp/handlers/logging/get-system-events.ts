import { z } from "zod";
import type { RegisterGovToolDeps } from "../types.js";
import type { SystemEventName, SystemEventRecord } from "../../core/event/system-event-manager.js";

export interface DefineGetSystemEventsToolDeps extends RegisterGovToolDeps {
  loadSystemEvents: (limit?: number, event?: SystemEventName) => Promise<SystemEventRecord[]>;
}

export function defineGetSystemEventsTool(deps: DefineGetSystemEventsToolDeps): void {
  const { govTool, loadSystemEvents } = deps;

  govTool(
    "get_system_events",
    {
      title: "システムイベント取得",
      description: "システムイベントログを取得します。",
      inputSchema: {
        limit: z.number().int().min(1).max(200).optional(),
        event: z.enum([
          "session_start",
          "turn_complete",
          "tool_before_execute",
          "tool_after_execute",
          "preset_before_execute",
          "governance_threshold_exceeded",
          "low_relevance_detected",
          "low_confidence_selection",
          "history_saved",
          "error_aggregate_detected",
          "session_end"
        ]).optional()
      }
    },
    async ({ limit, event }: { limit?: number; event?: SystemEventName }) => {
      const events = await loadSystemEvents(limit ?? 50, event);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                count: events.length,
                event: event ?? null,
                events
              },
              null,
              2
            )
          }
        ]
      };
    }
  );
}
