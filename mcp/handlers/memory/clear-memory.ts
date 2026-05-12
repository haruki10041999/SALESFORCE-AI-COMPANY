import type { RegisterMemoryToolsDeps } from "../register-memory-tools.js";

export function defineClearMemoryTool(deps: RegisterMemoryToolsDeps): void {
  const { govTool, clearMemory } = deps;

  govTool(
    "clear_memory",
    {
      title: "メモリクリア",
      description: "メモリ内容をすべてクリアします。",
      inputSchema: {}
    },
    async () => {
      await clearMemory();
      return {
        content: [{ type: "text", text: "Memory cleared." }]
      };
    }
  );
}
