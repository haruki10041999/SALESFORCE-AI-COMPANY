import { z } from "zod";
import type { RegisterMemoryToolsDeps } from "../register-memory-tools.js";

export function defineRecordFailureTool(deps: RegisterMemoryToolsDeps): void {
  const { govTool, recordFailureMemory } = deps;

  govTool(
    "record_failure",
    {
      title: "失敗メモリ記録",
      description: "失敗パターンと再発防止策を記録します。",
      inputSchema: {
        pattern: z.string().min(1),
        reason: z.string().min(1),
        preventiveAction: z.string().min(1),
        tags: z.array(z.string().min(1)).optional()
      }
    },
    async ({ pattern, reason, preventiveAction, tags }: {
      pattern: string;
      reason: string;
      preventiveAction: string;
      tags?: string[];
    }) => {
      const recorded = await recordFailureMemory({
        pattern,
        reason,
        preventiveAction,
        tags
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ recorded }, null, 2)
          }
        ]
      };
    }
  );
}
