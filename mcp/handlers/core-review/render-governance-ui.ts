import { z } from "zod";
import { resolve } from "node:path";
import { getOutputsDir } from "../../core/config/runtime-config.js";
import { LocalOutputsAdapter } from "../../infrastructure/outputs/local-outputs-adapter.js";
import { executeRenderGovernanceUi } from "../../core/application/governance/services/resource-governance-ui.js";
import type { RegisterGovToolDeps } from "../types.js";
import type { GovernanceState } from "../../core/governance/governance-state.js";

export interface DefineRenderGovernanceUiDeps extends RegisterGovToolDeps {
  loadGovernanceState: () => Promise<GovernanceState>;
}

export function defineRenderGovernanceUiTool(deps: DefineRenderGovernanceUiDeps): void {
  const { govTool, loadGovernanceState } = deps;
  const outputsDir = resolve(getOutputsDir());
  const outputsPort = new LocalOutputsAdapter({ outputsDir });

  govTool(
    "render_governance_ui",
    {
      title: "Governance ルール簡易 Web UI",
      description: "Governance 状態から HTML / Markdown ダッシュボードを生成します。必要時のみ write=true で保存します。",
      inputSchema: z.object({
        format: z.enum(["html", "markdown", "json"]).optional(),
        topPerType: z.number().int().min(1).max(100).optional(),
        title: z.string().optional(),
        write: z.boolean().optional()
      })
    },
    async ({ format, topPerType, title, write }: {
      format?: "html" | "markdown" | "json";
      topPerType?: number;
      title?: string;
      write?: boolean;
    }) => {
      const result = await executeRenderGovernanceUi({
        format,
        topPerType,
        title,
        write,
        outputsDir,
        loadGovernanceState,
        outputsPort
      });
      return { content: [{ type: "text", text: result.text }] };
    }
  );
}
