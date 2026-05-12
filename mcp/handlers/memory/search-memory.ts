import { z } from "zod";
import type { RegisterMemoryToolsDeps } from "../register-memory-tools.js";

export function defineSearchMemoryTool(deps: RegisterMemoryToolsDeps): void {
  const { govTool, searchMemory } = deps;

  govTool(
    "search_memory",
    {
      title: "メモリ検索",
      description: "メモリ内容を検索します。",
      inputSchema: {
        query: z.string().min(1)
      }
    },
    async ({ query }: { query: string }) => {
      const results = await searchMemory(query);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ query, results, count: results.length }, null, 2)
          }
        ]
      };
    }
  );
}
