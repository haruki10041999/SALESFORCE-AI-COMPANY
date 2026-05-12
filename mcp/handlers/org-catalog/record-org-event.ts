import { z } from "zod";
import type { GovTool } from "../../tool-types.js";
import { recordOrgTimelineEvent } from "../../core/org/org-timeline-store.js";

export function defineRecordOrgEventTool(govTool: GovTool, timelineDir: string): void {
  govTool(
    "record_org_event",
    {
      title: "Org タイムライン記録",
      description: "指定 Org のタイムラインにイベントを記録します。",
      inputSchema: {
        alias: z.string().min(1).max(64),
        type: z.string().min(1).max(64),
        summary: z.string().min(1).max(2000),
        metadata: z.record(z.unknown()).optional(),
        recordedAt: z.string().datetime().optional()
      }
    },
    async ({ alias, type, summary, metadata, recordedAt }: {
      alias: string;
      type: string;
      summary: string;
      metadata?: Record<string, unknown>;
      recordedAt?: string;
    }) => {
      const event = await recordOrgTimelineEvent(timelineDir, alias, {
        type,
        summary,
        metadata,
        recordedAt
      });
      return {
        content: [{ type: "text", text: JSON.stringify({ alias, event }, null, 2) }]
      };
    }
  );
}
