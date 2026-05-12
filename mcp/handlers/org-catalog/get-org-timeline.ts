import { z } from "zod";
import type { GovTool } from "../../tool-types.js";
import { getOrgTimelineEvents } from "../../core/org/org-timeline-store.js";

export function defineGetOrgTimelineTool(govTool: GovTool, timelineDir: string): void {
  govTool(
    "get_org_timeline",
    {
      title: "Org タイムライン取得",
      description: "指定 Org のタイムラインイベントを新しい順で取得します。",
      inputSchema: {
        alias: z.string().min(1).max(64),
        limit: z.number().int().min(1).max(500).optional()
      }
    },
    async ({ alias, limit }: { alias: string; limit?: number }) => {
      const events = await getOrgTimelineEvents(timelineDir, alias, limit ?? 100);
      return {
        content: [{ type: "text", text: JSON.stringify({ alias, count: events.length, events }, null, 2) }]
      };
    }
  );
}
