import type { RegisterResourceCatalogToolsDeps } from "../register-resource-catalog-tools.js";

export function defineListPersonasTool(deps: RegisterResourceCatalogToolsDeps): void {
  const { govTool, listMdFiles } = deps;

  govTool(
    "list_personas",
    {
      title: "ペルソナ一覧",
      description: "利用可能なAIペルソナ（性格・コミュニケーションスタイル）を一覧表示します。",
      inputSchema: {}
    },
    async () => {
      const personas = listMdFiles("personas");
      return { content: [{ type: "text", text: JSON.stringify(personas, null, 2) }] };
    }
  );
}
