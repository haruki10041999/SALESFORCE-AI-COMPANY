import { z } from "zod";
import { buildDeployCommand } from "../../tools/deploy-org.js";
import type { RegisterGovToolDeps } from "../types.js";

export interface DefineDeployOrgDeps extends RegisterGovToolDeps {}

export function defineDeployOrgTool(deps: DefineDeployOrgDeps): void {
  const { govTool } = deps;

  govTool(
    "deploy_org",
    {
      title: "Orgデプロイ",
      description: "Salesforce組織向けのデプロイコマンドを生成します。",
      inputSchema: {
        targetOrg: z.string(),
        dryRun: z.boolean().optional(),
        sourceDir: z.string().optional(),
        testLevel: z.enum(["NoTestRun", "RunLocalTests", "RunAllTestsInOrg", "RunSpecifiedTests"]).optional(),
        specificTests: z.array(z.string()).optional(),
        wait: z.number().int().min(1).max(120).optional(),
        ignoreWarnings: z.boolean().optional()
      }
    },
    async ({ targetOrg, dryRun, sourceDir, testLevel, specificTests, wait, ignoreWarnings }: {
      targetOrg: string;
      dryRun?: boolean;
      sourceDir?: string;
      testLevel?: "NoTestRun" | "RunLocalTests" | "RunAllTestsInOrg" | "RunSpecifiedTests";
      specificTests?: string[];
      wait?: number;
      ignoreWarnings?: boolean;
    }) => {
      const result = buildDeployCommand({ targetOrg, dryRun, sourceDir, testLevel, specificTests, wait, ignoreWarnings });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );
}
