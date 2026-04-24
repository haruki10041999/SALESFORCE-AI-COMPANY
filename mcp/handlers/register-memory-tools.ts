import { z } from "zod";
import type { GovTool } from "@mcp/tool-types.js";

interface RegisterMemoryToolsDeps {
  govTool: GovTool;
  addMemory: (text: string) => void;
  searchMemory: (query: string) => string[];
  listMemory: () => string[];
  clearMemory: () => void;
}

export function registerMemoryTools(deps: RegisterMemoryToolsDeps): void {
  const { govTool, addMemory, searchMemory, listMemory, clearMemory } = deps;

  govTool(
    "add_memory",
    {
      title: "メモリ追加",
      description: "メモリに新しい項目を追加します。",
      inputSchema: {
        text: z.string().min(1)
      }
    },
    async ({ text }: { text: string }) => {
      addMemory(text);
      return {
        content: [{ type: "text", text: `保存しました: ${text.slice(0, 80)}${text.length > 80 ? "..." : ""}` }]
      };
    }
  );

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
      const results = searchMemory(query);
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

  govTool(
    "list_memory",
    {
      title: "メモリ一覧",
      description: "メモリ項目を一覧表示します。",
      inputSchema: {}
    },
    async () => {
      const items = listMemory();
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

  govTool(
    "clear_memory",
    {
      title: "メモリクリア",
      description: "メモリ内容をすべてクリアします。",
      inputSchema: {}
    },
    async () => {
      clearMemory();
      return {
        content: [{ type: "text", text: "Memory cleared." }]
      };
    }
  );
}
