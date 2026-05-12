import { z } from "zod";
import { runDeploymentVerification } from "../../tools/run-deployment-verification.js";
import type { RegisterGovToolDeps } from "../types.js";

export interface DefineRunDeploymentVerificationDeps extends RegisterGovToolDeps {}

export function defineRunDeploymentVerificationTool(deps: DefineRunDeploymentVerificationDeps): void {
  const { govTool } = deps;

  govTool(
    "run_deployment_verification",
    {
      title: "デプロイ検証判定",
      description: "デプロイ後スモークテスト結果を評価し、rollback/continue/monitor を判定してレポート出力します。",
      inputSchema: {
        targetOrg: z.string(),
        dryRun: z.boolean().optional(),
        deploymentSucceeded: z.boolean().optional(),
        smokeClassNames: z.array(z.string()).optional(),
        smokeSuiteName: z.string().optional(),
        wait: z.number().int().min(1).max(180).optional(),
        outputDir: z.string().optional(),
        smokeResult: z.object({
          totalTests: z.number().int().min(0),
          passedTests: z.number().int().min(0).optional(),
          failedTests: z.number().int().min(0),
          skippedTests: z.number().int().min(0).optional(),
          criticalFailures: z.number().int().min(0).optional()
        }).optional(),
        failureRateThresholdPercent: z.number().min(0).max(100).optional(),
        criticalFailureThreshold: z.number().int().min(0).max(1000).optional(),
        reportOutputDir: z.string().optional()
      }
    },
    async ({
      targetOrg,
      dryRun,
      deploymentSucceeded,
      smokeClassNames,
      smokeSuiteName,
      wait,
      outputDir,
      smokeResult,
      failureRateThresholdPercent,
      criticalFailureThreshold,
      reportOutputDir
    }: {
      targetOrg: string;
      dryRun?: boolean;
      deploymentSucceeded?: boolean;
      smokeClassNames?: string[];
      smokeSuiteName?: string;
      wait?: number;
      outputDir?: string;
      smokeResult?: {
        totalTests: number;
        passedTests?: number;
        failedTests: number;
        skippedTests?: number;
        criticalFailures?: number;
      };
      failureRateThresholdPercent?: number;
      criticalFailureThreshold?: number;
      reportOutputDir?: string;
    }) => {
      const result = await runDeploymentVerification({
        targetOrg,
        dryRun,
        deploymentSucceeded,
        smokeClassNames,
        smokeSuiteName,
        wait,
        outputDir,
        smokeResult,
        failureRateThresholdPercent,
        criticalFailureThreshold,
        reportOutputDir
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );
}
