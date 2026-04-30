import { z } from "zod";
import type { RegisterGovToolDeps } from "./types.js";

interface RegisterMemoryToolsDeps extends RegisterGovToolDeps {
  addMemory: (text: string) => void;
  searchMemory: (query: string) => string[];
  listMemory: () => string[];
  clearMemory: () => void;
  recordFailureMemory: (input: {
    pattern: string;
    reason: string;
    preventiveAction: string;
    tags?: string[];
  }) => {
    pattern: string;
    reason: string;
    preventiveAction: string;
    tags: string[];
    recordedAt: string;
  };
  searchFailureMemory: (query: string, limit?: number) => Array<{
    pattern: string;
    reason: string;
    preventiveAction: string;
    tags: string[];
    recordedAt: string;
  }>;
  listFailureMemory: (limit?: number) => Array<{
    pattern: string;
    reason: string;
    preventiveAction: string;
    tags: string[];
    recordedAt: string;
  }>;
}

export function registerMemoryTools(deps: RegisterMemoryToolsDeps): void {
  const {
    govTool,
    addMemory,
    searchMemory,
    listMemory,
    clearMemory,
    recordFailureMemory,
    searchFailureMemory,
    listFailureMemory
  } = deps;

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
      const recorded = recordFailureMemory({
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
      const results = searchFailureMemory(query, limit ?? 10);
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
      const items = listFailureMemory(limit ?? 50);
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
