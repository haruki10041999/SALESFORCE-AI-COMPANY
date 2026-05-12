import type { RegisterMemoryToolsDeps } from "../register-memory-tools.js";

export function defineListMemoryTool(deps: RegisterMemoryToolsDeps): void {
  const { govTool, listMemory } = deps;

  govTool(
    "list_memory",
    {
      title: "メモリ一覧",
      description: "メモリ項目を一覧表示します。",
      inputSchema: {}
    },
    async () => {
      const items = await listMemory();
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
