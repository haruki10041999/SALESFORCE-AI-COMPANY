import { z } from "zod";
import type { RegisterMemoryToolsDeps } from "../register-memory-tools.js";

export function defineSearchFailuresTool(deps: RegisterMemoryToolsDeps): void {
  const { govTool, searchFailureMemory } = deps;

  govTool(
    "search_failures",
    {
      title: "失敗メモリ検索",
      description: "失敗パターン専用メモリを検索します。",
      inputSchema: {
        query: z.string().min(1),
        limit: z.number().int().min(1).max(100).optional()
      }
    },
    async ({ query, limit }: { query: string; limit?: number }) => {
      const results = await searchFailureMemory(query, limit ?? 10);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ query, count: results.length, results }, null, 2)
          }
        ]
      };
    }
  );
}
