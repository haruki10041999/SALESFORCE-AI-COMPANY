import { z } from "zod";
import { buildDeployCommand } from "../../tools/deploy-org.js";
import type { RegisterGovToolDeps } from "../types.js";
import { defineSaga } from "../../core/ports/saga.js";
import { runSaga } from "../../infrastructure/workflow/saga-runner.js";

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
      let result: Record<string, unknown> = {};
      const saga = defineSaga({
        name: "deploy_org",
        steps: [
          {
            name: "compile-deploy-command",
            do: async () => {
              result = buildDeployCommand({ targetOrg, dryRun, sourceDir, testLevel, specificTests, wait, ignoreWarnings });
            }
          }
        ]
      });

      const sagaResult = await runSaga({
        saga,
        context: {}
      });

      const payload: Record<string, unknown> = {
        ...result,
        saga: {
          status: sagaResult.status,
          completedSteps: sagaResult.completedSteps,
          compensatedSteps: sagaResult.compensatedSteps,
          compensationFailures: sagaResult.compensationFailures.map((failure) => ({
            step: failure.step,
            error: String(failure.error)
          }))
        }
      };

      if (sagaResult.failure) {
        payload.error = {
          step: sagaResult.failure.step,
          message: String(sagaResult.failure.error)
        };
      }

      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }]
      };
    }
  );
}
