import { z } from "zod";
import type { RegisterMemoryToolsDeps } from "../register-memory-tools.js";

export function defineListFailuresTool(deps: RegisterMemoryToolsDeps): void {
  const { govTool, listFailureMemory } = deps;

  govTool(
    "list_failures",
    {
      title: "失敗メモリ一覧",
      description: "記録済み失敗パターンを一覧表示します。",
      inputSchema: {
        limit: z.number().int().min(1).max(200).optional()
      }
    },
    async ({ limit }: { limit?: number }) => {
      const items = await listFailureMemory(limit ?? 50);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ count: items.length, items }, null, 2)
          }
        ]
      };
    }
  );
}
