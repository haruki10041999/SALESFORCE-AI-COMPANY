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
import { compareOrgMetadata } from "../tools/org-metadata-diff.js";
import { simulateFlowCondition } from "../tools/flow-condition-simulator.js";
import { diffPermissionSet } from "../tools/permission-set-diff.js";
import { buildApexDependencyGraph } from "../tools/apex-dependency-graph.js";
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

  govTool(
    "compare_org_metadata",
    {
      title: "複数Orgメタデータ差分比較",
      description: "基準OrgのインベントリJSONを基準に、複数Orgのメタデータ差分を比較します。",
      inputSchema: {
        baselineOrg: z.string(),
        baselineInventoryFile: z.string(),
        compareOrgs: z.array(
          z.object({
            org: z.string(),
            inventoryFile: z.string()
          })
        ).min(1),
        sampleLimit: z.number().int().min(1).max(100).optional()
      }
    },
    async ({
      baselineOrg,
      baselineInventoryFile,
      compareOrgs,
      sampleLimit
    }: {
      baselineOrg: string;
      baselineInventoryFile: string;
      compareOrgs: Array<{ org: string; inventoryFile: string }>;
      sampleLimit?: number;
    }) => {
      const result = compareOrgMetadata({
        baselineOrg,
        baselineInventoryFile,
        compareOrgs,
        sampleLimit
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );

  govTool(
    "flow_condition_simulate",
    {
      title: "Flow条件シミュレータ",
      description: "入力レコードと条件ツリーを評価し、Flow が起動するかを判定します。",
      inputSchema: {
        flowName: z.string().optional(),
        record: z.record(z.string(), z.any()),
        condition: z.any()
      }
    },
    async ({
      flowName,
      record,
      condition
    }: {
      flowName?: string;
      record: Record<string, unknown>;
      condition: unknown;
    }) => {
      const result = simulateFlowCondition({
        flowName,
        record,
        condition: condition as never
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );

  govTool(
    "permission_set_diff",
    {
      title: "Permission Set差分検出",
      description: "2つの Permission Set XML を比較し、不足権限と過剰権限を検出します。",
      inputSchema: {
        baselineFilePath: z.string(),
        targetFilePath: z.string(),
        sampleLimit: z.number().int().min(1).max(100).optional()
      }
    },
    async ({
      baselineFilePath,
      targetFilePath,
      sampleLimit
    }: {
      baselineFilePath: string;
      targetFilePath: string;
      sampleLimit?: number;
    }) => {
      const result = diffPermissionSet({
        baselineFilePath,
        targetFilePath,
        sampleLimit
      });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );

  govTool(
    "apex_dependency_graph",
    {
      title: "Apex依存グラフ可視化",
      description: "Apexクラス/トリガーの依存関係を解析し、グラフ情報とMermaidを返します。",
      inputSchema: {
        rootDir: z.string(),
        includeTests: z.boolean().optional(),
        sampleLimit: z.number().int().min(1).max(100).optional()
      }
    },
    async ({ rootDir, includeTests, sampleLimit }: { rootDir: string; includeTests?: boolean; sampleLimit?: number }) => {
      const result = buildApexDependencyGraph({
        rootDir,
        includeTests,
        sampleLimit
      });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );
}

