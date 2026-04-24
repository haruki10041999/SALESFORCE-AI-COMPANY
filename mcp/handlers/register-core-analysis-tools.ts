import { z } from "zod";
import { analyzeRepo } from "../tools/repo-analyzer.js";
import { analyzeApex } from "../tools/apex-analyzer.js";
import { analyzeLwc } from "../tools/lwc-analyzer.js";
import { analyzeFlow } from "../tools/flow-analyzer.js";
import { analyzePermissionSet } from "../tools/permission-set-analyzer.js";
import { buildDeployCommand } from "../tools/deploy-org.js";
import { buildTestCommand } from "../tools/run-tests.js";
import { summarizeMetrics } from "../tools/metrics-summary.js";
import { generateDeploymentPlan } from "../tools/deployment-plan-generator.js";
import { runBenchmarkSuite } from "../tools/benchmark-suite.js";
import type { GovTool } from "@mcp/tool-types.js";

export function registerCoreAnalysisTools(govTool: GovTool): void {
  govTool(
    "repo_analyze",
    {
      title: "リポジトリ解析",
      description: "Salesforceリポジトリを解析し、主要ファイルの一覧を返します。",
      inputSchema: {
        path: z.string()
      }
    },
    async ({ path }: { path: string }) => {
      const result = analyzeRepo(path);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );

  govTool(
    "apex_analyze",
    {
      title: "Apex解析",
      description: "Apexファイルに対して簡易静的チェックを実行します。",
      inputSchema: {
        filePath: z.string()
      }
    },
    async ({ filePath }: { filePath: string }) => {
      const result = analyzeApex(filePath);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );

  govTool(
    "lwc_analyze",
    {
      title: "LWC解析",
      description: "LWC JavaScriptファイルに対して簡易静的チェックを実行します。",
      inputSchema: {
        filePath: z.string()
      }
    },
    async ({ filePath }: { filePath: string }) => {
      const result = analyzeLwc(filePath);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );

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

  govTool(
    "run_tests",
    {
      title: "テスト実行",
      description: "Apexテスト実行コマンドを生成します。",
      inputSchema: {
        targetOrg: z.string(),
        classNames: z.array(z.string()).optional(),
        suiteName: z.string().optional(),
        wait: z.number().int().min(1).max(120).optional(),
        outputDir: z.string().optional()
      }
    },
    async ({ targetOrg, classNames, suiteName, wait, outputDir }: {
      targetOrg: string;
      classNames?: string[];
      suiteName?: string;
      wait?: number;
      outputDir?: string;
    }) => {
      const command = buildTestCommand({ targetOrg, classNames, suiteName, wait, outputDir });
      return {
        content: [{ type: "text", text: command }]
      };
    }
  );

  govTool(
    "flow_analyze",
    {
      title: "Flow解析",
      description: "Salesforce Flowメタデータファイルに対して簡易静的チェックを実行します。",
      inputSchema: {
        filePath: z.string()
      }
    },
    async ({ filePath }: { filePath: string }) => {
      const result = analyzeFlow(filePath);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );

  govTool(
    "permission_set_analyze",
    {
      title: "権限セット解析",
      description: "Salesforce権限セットメタデータファイルに対して簡易静的チェックを実行します。",
      inputSchema: {
        filePath: z.string()
      }
    },
    async ({ filePath }: { filePath: string }) => {
      const result = analyzePermissionSet(filePath);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );

  govTool(
    "metrics_summary",
    {
      title: "メトリクス要約",
      description: "トレース履歴から最近のツール実行メトリクスを要約します。",
      inputSchema: {
        limit: z.number().int().min(1).max(1000).optional()
      }
    },
    async ({ limit }: { limit?: number }) => {
      const result = summarizeMetrics({ limit });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );

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

  govTool(
    "benchmark_suite",
    {
      title: "ベンチマーク実行",
      description: "最近のトレースメトリクスを基に軽量ベンチマーク評価を実行します。",
      inputSchema: {
        scenarios: z.array(z.string()).optional(),
        recentTraceLimit: z.number().int().min(1).max(5000).optional()
      }
    },
    async ({ scenarios, recentTraceLimit }: { scenarios?: string[]; recentTraceLimit?: number }) => {
      const result = runBenchmarkSuite({ scenarios, recentTraceLimit });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );
}

