import { z } from "zod";
import type { RegisterResourceCatalogToolsDeps } from "../register-resource-catalog-tools.js";

export function defineGetAgentTool(deps: RegisterResourceCatalogToolsDeps): void {
  const { govTool, getMdFile } = deps;

  govTool(
    "get_agent",
    {
      title: "エージェント定義取得",
      description: "指定した名前のエージェント定義Markdown全文を返します。",
      inputSchema: { name: z.string() }
    },
    async ({ name }: { name: string }) => {
      const content = getMdFile("agents", name);
      return { content: [{ type: "text", text: content }] };
    }
  );
}
