import { z } from "zod";

type GovTool = (name: string, config: any, handler: any) => void;

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
      title: "Add Memory",
      description: "テキストをインメモリに記録します。",
      inputSchema: {
        text: z.string().min(1)
      }
    },
    async ({ text }: { text: string }) => {
      addMemory(text);
      return {
        content: [{ type: "text", text: `記録しました: ${text.slice(0, 80)}${text.length > 80 ? "..." : ""}` }]
      };
    }
  );

  govTool(
    "search_memory",
    {
      title: "Search Memory",
      description: "インメモリから部分一致でテキストを検索します。",
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
      title: "List Memory",
      description: "インメモリの全記録を返します。",
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
      title: "Clear Memory",
      description: "インメモリの全記録を削除します。",
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