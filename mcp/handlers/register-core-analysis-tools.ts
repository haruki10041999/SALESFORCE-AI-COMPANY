import { z } from "zod";
import { existsSync, readdirSync, readFileSync, statSync, type Dirent } from "node:fs";
import { join, relative } from "node:path";
import { shouldSkipScanDir } from "../core/quality/scan-exclusions.js";
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
import { suggestFlowTestCases } from "../tools/suggest-flow-test-cases.js";
import { diffPermissionSet } from "../tools/permission-set-diff.js";
import { recommendPermissionSets } from "../tools/recommend-permission-sets.js";
import { buildApexDependencyGraph } from "../tools/apex-dependency-graph.js";
import { buildApexDependencyGraphIncremental } from "../tools/apex-dependency-graph-incremental.js";
import { buildApexComplianceReport } from "../tools/apex-compliance-report.js";
import { scanSecurityRules, type SecurityScanInput } from "../tools/security-rule-scan.js";
import { suggestRefactors } from "../tools/refactor-suggest.js";
import { generateApexChangelog } from "../tools/apex-changelog.js";
import { predictApexPerformance } from "../tools/apex-perf-predict.js";
import { recommendSkillsForRole } from "../tools/recommend-skills-for-role.js";
import { analyzeTestCoverageGap } from "../tools/analyze-test-coverage-gap.js";
import { runDeploymentVerification } from "../tools/run-deployment-verification.js";
import type { GovTool } from "@mcp/tool-types.js";

export interface CoreAnalysisToolDeps {
  /** Optional. Provided by server.ts so `recommend_skills_for_role` can list skills with summaries. */
  listSkillsWithSummary?: () => Array<{ name: string; summary: string }>;
}

export function registerCoreAnalysisTools(govTool: GovTool, deps: CoreAnalysisToolDeps = {}): void {
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
      description: "トレース履歴から最近のツール実行メトリクスを要約します。tool 別 SLA 閾値も指定可能です。",
      inputSchema: {
        limit: z.number().int().min(1).max(1000).optional(),
        maxP95Ms: z.number().int().positive().optional(),
        maxErrorRatePercent: z.number().min(0).max(100).optional(),
        toolSlaThresholds: z.record(
          z.string(),
          z.object({
            maxP95Ms: z.number().int().positive().optional(),
            maxErrorRatePercent: z.number().min(0).max(100).optional()
          })
        ).optional()
      }
    },
    async ({
      limit,
      maxP95Ms,
      maxErrorRatePercent,
      toolSlaThresholds
    }: {
      limit?: number;
      maxP95Ms?: number;
      maxErrorRatePercent?: number;
      toolSlaThresholds?: Record<string, { maxP95Ms?: number; maxErrorRatePercent?: number }>;
    }) => {
      const result = summarizeMetrics({ limit, maxP95Ms, maxErrorRatePercent, toolSlaThresholds });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );

  // T-OBS-02: Prometheus 形式メトリクス
  govTool(
    "get_prometheus_metrics",
    {
      title: "Prometheus メトリクス取得",
      description:
        "ツール実行回数 / レイテンシ histogram / 失敗回数を Prometheus text format で返します。Grafana / Prometheus サーバの scrape target として利用できます。",
      inputSchema: {}
    },
    async () => {
      const { getPrometheusMetricsText } = await import("../core/observability/prometheus-metrics.js");
      const { contentType, text } = await getPrometheusMetricsText();
      return {
        content: [
          { type: "text", text: text.length > 0 ? text : "# prom-client unavailable\n" },
          { type: "text", text: `# content-type: ${contentType}` }
        ]
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
    "suggest_flow_test_cases",
    {
      title: "Flowテストケース提案",
      description: "Flow の decision rule から未到達パスを抽出し、条件組合せのテストケースを提案します。",
      inputSchema: {
        filePath: z.string(),
        coveredPaths: z.array(z.string()).optional(),
        maxCases: z.number().int().min(1).max(200).optional(),
        reportOutputDir: z.string().optional(),
        includeDefaultPaths: z.boolean().optional()
      }
    },
    async ({ filePath, coveredPaths, maxCases, reportOutputDir, includeDefaultPaths }: {
      filePath: string;
      coveredPaths?: string[];
      maxCases?: number;
      reportOutputDir?: string;
      includeDefaultPaths?: boolean;
    }) => {
      const result = await suggestFlowTestCases({
        filePath,
        coveredPaths,
        maxCases,
        reportOutputDir,
        includeDefaultPaths
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
    "recommend_permission_sets",
    {
      title: "Permission Set推奨",
      description: "最近の利用権限シグナル(Object/Field/Apex)に基づき、最小権限セット候補を推奨します。",
      inputSchema: {
        permissionSetFiles: z.array(z.string()).min(1).max(100),
        usage: z.object({
          objects: z.array(z.string()).optional(),
          fields: z.array(z.string()).optional(),
          apexClasses: z.array(z.string()).optional(),
          systemPermissions: z.array(z.string()).optional()
        }).optional(),
        usageLogFile: z.string().optional(),
        currentPermissionSetFile: z.string().optional(),
        objectAccessLevel: z.enum(["read", "edit", "create", "delete"]).optional(),
        maxRecommendations: z.number().int().min(1).max(50).optional(),
        reportOutputDir: z.string().optional()
      }
    },
    async ({
      permissionSetFiles,
      usage,
      usageLogFile,
      currentPermissionSetFile,
      objectAccessLevel,
      maxRecommendations,
      reportOutputDir
    }: {
      permissionSetFiles: string[];
      usage?: {
        objects?: string[];
        fields?: string[];
        apexClasses?: string[];
        systemPermissions?: string[];
      };
      usageLogFile?: string;
      currentPermissionSetFile?: string;
      objectAccessLevel?: "read" | "edit" | "create" | "delete";
      maxRecommendations?: number;
      reportOutputDir?: string;
    }) => {
      const result = await recommendPermissionSets({
        permissionSetFiles,
        usage,
        usageLogFile,
        currentPermissionSetFile,
        objectAccessLevel,
        maxRecommendations,
        reportOutputDir
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );

  govTool(
    "analyze_test_coverage_gap",
    {
      title: "テストカバレッジギャップ解析",
      description: "変更Apexクラス/トリガーに対し対応テスト不足を検出し、JSON/Markdownレポートを出力します。",
      inputSchema: {
        repoPath: z.string(),
        baseBranch: z.string().optional(),
        integrationBranch: z.string().optional(),
        workingBranch: z.string(),
        targetOrg: z.string().optional(),
        reportOutputDir: z.string().optional(),
        maxItems: z.number().int().min(1).max(500).optional(),
        includeBranchScaffold: z.boolean().optional()
      }
    },
    async ({
      repoPath,
      baseBranch,
      integrationBranch,
      workingBranch,
      targetOrg,
      reportOutputDir,
      maxItems,
      includeBranchScaffold
    }: {
      repoPath: string;
      baseBranch?: string;
      integrationBranch?: string;
      workingBranch: string;
      targetOrg?: string;
      reportOutputDir?: string;
      maxItems?: number;
      includeBranchScaffold?: boolean;
    }) => {
      const result = await analyzeTestCoverageGap({
        repoPath,
        baseBranch,
        integrationBranch,
        workingBranch,
        targetOrg,
        reportOutputDir,
        maxItems,
        includeBranchScaffold
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
      description: "Apexクラス/トリガーの依存関係を解析し、グラフ情報とMermaidを返します。Flow/PermissionSet/外部連携も任意で含められます。",
      inputSchema: {
        rootDir: z.string(),
        includeTests: z.boolean().optional(),
        sampleLimit: z.number().int().min(1).max(100).optional(),
        includeFlows: z.boolean().optional(),
        includePermissionSets: z.boolean().optional(),
        includeIntegrations: z.boolean().optional()
      }
    },
    async ({ rootDir, includeTests, sampleLimit, includeFlows, includePermissionSets, includeIntegrations }: {
      rootDir: string;
      includeTests?: boolean;
      sampleLimit?: number;
      includeFlows?: boolean;
      includePermissionSets?: boolean;
      includeIntegrations?: boolean;
    }) => {
      const result = buildApexDependencyGraph({
        rootDir,
        includeTests,
        sampleLimit,
        includeFlows,
        includePermissionSets,
        includeIntegrations
      });

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );

  govTool(
    "apex_dependency_graph_incremental",
    {
      title: "Apex依存グラフ(差分モード)",
      description: "前回スキャンとのファイル差分を検出し、グラフ全体に added/modified/deleted を付与して返します。CI で大規模 Org の差分監視に利用できます。",
      inputSchema: {
        rootDir: z.string(),
        cacheFile: z.string(),
        includeTests: z.boolean().optional(),
        sampleLimit: z.number().int().min(1).max(100).optional(),
        includeFlows: z.boolean().optional(),
        includePermissionSets: z.boolean().optional(),
        includeIntegrations: z.boolean().optional()
      }
    },
    async ({ rootDir, cacheFile, includeTests, sampleLimit, includeFlows, includePermissionSets, includeIntegrations }: {
      rootDir: string;
      cacheFile: string;
      includeTests?: boolean;
      sampleLimit?: number;
      includeFlows?: boolean;
      includePermissionSets?: boolean;
      includeIntegrations?: boolean;
    }) => {
      const result = buildApexDependencyGraphIncremental({
        rootDir,
        cacheFile,
        includeTests,
        sampleLimit,
        includeFlows,
        includePermissionSets,
        includeIntegrations
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );

  govTool(
    "apex_compliance_report",
    {
      title: "Apex 統合コンプライアンスレポート",
      description: "指定 rootDir 配下の Apex を一括スキャンし、依存グラフ + セキュリティ違反 + パフォーマンスリスクを 1 つの統合レポートにまとめます。CI のゲートや PR コメント生成に利用できます。",
      inputSchema: {
        rootDir: z.string(),
        includeTests: z.boolean().optional(),
        sampleLimit: z.number().int().min(1).max(500).optional()
      }
    },
    async ({ rootDir, includeTests, sampleLimit }: {
      rootDir: string;
      includeTests?: boolean;
      sampleLimit?: number;
    }) => {
      const sources = collectApexSources(rootDir, includeTests, sampleLimit);
      const dependency = buildApexDependencyGraph({ rootDir, includeTests, sampleLimit });
      const security = scanSecurityRules(sources);
      const performance = predictApexPerformance(sources);
      const report = buildApexComplianceReport({
        rootPath: rootDir,
        fileCount: sources.length,
        dependency,
        security,
        performance
      });
      return {
        content: [{ type: "text", text: JSON.stringify(report, null, 2) }]
      };
    }
  );

  govTool(
    "refactor_suggest",
    {
      title: "Refactor提案エンジン",
      description: "与えられた Apex ソースをスキャンし、長いメソッド / 深いネスト / 重複リテラル / マジックナンバーを検出してリファクタ提案を返します。",
      inputSchema: {
        source: z.string(),
        filePath: z.string().optional(),
        maxMethodLines: z.number().int().min(10).max(2000).optional(),
        maxNestingDepth: z.number().int().min(2).max(20).optional(),
        minLiteralOccurrences: z.number().int().min(2).max(50).optional(),
        minMagicOccurrences: z.number().int().min(2).max(50).optional()
      }
    },
    async (input: {
      source: string;
      filePath?: string;
      maxMethodLines?: number;
      maxNestingDepth?: number;
      minLiteralOccurrences?: number;
      minMagicOccurrences?: number;
    }) => {
      const result = suggestRefactors(input);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );

  govTool(
    "apex_changelog",
    {
      title: "Apex Changelog 生成",
      description: "git 比較 (baseRef..headRef) から Apex / LWC / Flow / PermissionSet の変更をカテゴリ別に集計し、人間向け Markdown changelog と JSON を返します。",
      inputSchema: {
        repoPath: z.string(),
        baseRef: z.string(),
        headRef: z.string().optional(),
        maxCommits: z.number().int().min(1).max(500).optional()
      }
    },
    async ({ repoPath, baseRef, headRef, maxCommits }: {
      repoPath: string;
      baseRef: string;
      headRef?: string;
      maxCommits?: number;
    }) => {
      const result = generateApexChangelog({ repoPath, baseRef, headRef, maxCommits });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );

  govTool(
    "recommend_skills_for_role",
    {
      title: "コンテクスト連動スキル推薦",
      description: "役割 / トピック / 直近の変更ファイルから関連スキルをスコアリングして返します。",
      inputSchema: {
        role: z.string().optional(),
        topic: z.string().optional(),
        recentFiles: z.array(z.string()).optional(),
        limit: z.number().int().min(1).max(50).optional()
      }
    },
    async ({ role, topic, recentFiles, limit }: {
      role?: string;
      topic?: string;
      recentFiles?: string[];
      limit?: number;
    }) => {
      const skills = deps.listSkillsWithSummary ? deps.listSkillsWithSummary() : [];
      const result = recommendSkillsForRole({ role, topic, recentFiles, limit, skills });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );

  govTool(
    "predict_apex_performance",
    {
      title: "Apex 性能予測",
      description: "Apex ソースをヒューリスティックに走査し、SOQL/DML in loop などガバナ違反リスクをスコアします。",
      inputSchema: {
        files: z.array(z.object({
          filePath: z.string().min(1),
          source: z.string()
        })).min(1).max(500)
      }
    },
    async ({ files }: { files: Array<{ filePath: string; source: string }> }) => {
      const result = predictApexPerformance(files);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );
}


/**
 * Apex / Trigger ファイルを再帰収集し、`{filePath, source}` の配列で返す。
 * `apex_compliance_report` 用の共通ユーティリティ。
 */
function collectApexSources(rootDir: string, includeTests = false, sampleLimit?: number): SecurityScanInput[] {
  const out: SecurityScanInput[] = [];
  if (!existsSync(rootDir)) return out;
  const stack: string[] = [rootDir];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    let entries: Dirent[];
    try {
      entries = readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (shouldSkipScanDir(entry.name)) continue;
        stack.push(join(cur, entry.name));
        continue;
      }
      const name = entry.name.toLowerCase();
      if (!name.endsWith(".cls") && !name.endsWith(".trigger")) continue;
      const filePath = join(cur, entry.name);
      try {
        const st = statSync(filePath);
        if (!st.isFile()) continue;
        const source = readFileSync(filePath, "utf-8");
        if (!includeTests && /@isTest\b/i.test(source)) continue;
        out.push({ filePath: relative(rootDir, filePath) || filePath, source });
        if (sampleLimit && out.length >= sampleLimit) return out;
      } catch {
        continue;
      }
    }
  }
  return out;
}
