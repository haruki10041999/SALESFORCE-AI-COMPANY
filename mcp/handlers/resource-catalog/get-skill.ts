import { z } from "zod";
import type { RegisterResourceCatalogToolsDeps } from "../register-resource-catalog-tools.js";

export function defineGetSkillTool(deps: RegisterResourceCatalogToolsDeps): void {
  const { govTool, getMdFile } = deps;

  govTool(
    "get_skill",
    {
      title: "スキル定義取得",
      description: "指定した名前のスキルMarkdown全文を返します。",
      inputSchema: { name: z.string() }
    },
    async ({ name }: { name: string }) => {
      const content = getMdFile("skills", name);
      return { content: [{ type: "text", text: content }] };
    }
  );
}
