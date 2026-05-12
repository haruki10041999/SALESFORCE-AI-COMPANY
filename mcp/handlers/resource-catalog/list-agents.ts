import type { RegisterResourceCatalogToolsDeps } from "../register-resource-catalog-tools.js";

export function defineListAgentsTool(deps: RegisterResourceCatalogToolsDeps): void {
  const { govTool, listMdFiles } = deps;

  govTool(
    "list_agents",
    {
      title: "エージェント一覧",
      description: "利用可能なAIエージェントを短い説明付きで一覧表示します。",
      inputSchema: {}
    },
    async () => {
      const agents = listMdFiles("agents");
      return { content: [{ type: "text", text: JSON.stringify(agents, null, 2) }] };
    }
  );
}
