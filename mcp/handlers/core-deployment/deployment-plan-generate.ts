import { z } from "zod";
import { generateDeploymentPlan } from "../../tools/deployment-plan-generator.js";
import type { RegisterGovToolDeps } from "../types.js";

export interface DefineDeploymentPlanGenerateDeps extends RegisterGovToolDeps {}

export function defineDeploymentPlanGenerateTool(deps: DefineDeploymentPlanGenerateDeps): void {
  const { govTool } = deps;

  govTool(
    "deployment_plan_generate",
    {
      title: "デプロイ計画生成",
      description: "ブランチ差分からデプロイ順序・リスク・ロールバックのヒントを生成します。",
      inputSchema: {
        repoPath: z.string(),
        baseBranch: z.string().optional(),
        integrationBranch: z.string().optional(),
        workingBranch: z.string(),
        targetOrg: z.string().optional()
      }
    },
    async ({ repoPath, baseBranch, integrationBranch, workingBranch, targetOrg }: {
      repoPath: string;
      baseBranch?: string;
      integrationBranch?: string;
      workingBranch: string;
      targetOrg?: string;
    }) => {
      const result = generateDeploymentPlan({
        repoPath,
        baseBranch,
        integrationBranch,
        workingBranch,
        targetOrg
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );
}
