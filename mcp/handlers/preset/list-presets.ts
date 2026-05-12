import type { RegisterPresetToolsDeps } from "../register-preset-tools.js";

export function defineListPresetsTool(deps: RegisterPresetToolsDeps): void {
  const { govTool, listPresetsData } = deps;

  govTool(
    "list_presets",
    {
      title: "チャットプリセット一覧",
      description: "利用可能なチャットプリセットを一覧表示します。",
      inputSchema: {}
    },
    async () => {
      const presets = await listPresetsData();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              presets.map((p) => ({
                name: p.name,
                description: p.description,
                agents: p.agents
              })),
              null,
              2
            )
          }
        ]
      };
    }
  );
}
