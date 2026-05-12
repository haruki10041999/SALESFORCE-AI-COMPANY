import { z } from "zod";
import type { RegisterMemoryToolsDeps } from "../register-memory-tools.js";

export function defineAddMemoryTool(deps: RegisterMemoryToolsDeps): void {
  const { govTool, addMemory } = deps;

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
      await addMemory(text);
      return {
        content: [{ type: "text", text: `保存しました: ${text.slice(0, 80)}${text.length > 80 ? "..." : ""}` }]
      };
    }
  );
}
