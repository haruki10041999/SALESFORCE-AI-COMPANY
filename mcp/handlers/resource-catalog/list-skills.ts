import type { RegisterResourceCatalogToolsDeps } from "../register-resource-catalog-tools.js";

export function defineListSkillsTool(deps: RegisterResourceCatalogToolsDeps): void {
  const { govTool, listMdFiles } = deps;

  govTool(
    "list_skills",
    {
      title: "スキル一覧",
      description: "利用可能なSalesforceスキルを短い説明付きで一覧表示します。",
      inputSchema: {}
    },
    async () => {
      const skills = listMdFiles("skills");
      return { content: [{ type: "text", text: JSON.stringify(skills, null, 2) }] };
    }
  );
}
