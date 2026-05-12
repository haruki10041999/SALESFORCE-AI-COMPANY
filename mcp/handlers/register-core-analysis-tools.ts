import type { RegisterGovToolDeps } from "./types.js";
import { defineRepoAnalyzeTool } from "./core-analysis/repo-analyze.js";
import { defineApexAnalyzeTool } from "./core-analysis/apex-analyze.js";
import { defineLwcAnalyzeTool } from "./core-analysis/lwc-analyze.js";
import { defineFlowAnalyzeTool } from "./core-analysis/flow-analyze.js";
import { definePermissionSetAnalyzeTool } from "./core-analysis/permission-set-analyze.js";
import { defineDeployOrgTool } from "./core-deployment/deploy-org.js";
import { defineRunTestsTool } from "./core-deployment/run-tests.js";
import { defineRunDeploymentVerificationTool } from "./core-deployment/run-deployment-verification.js";
import { defineDeploymentPlanGenerateTool } from "./core-deployment/deployment-plan-generate.js";
import { defineBenchmarkSuiteTool } from "./core-deployment/benchmark-suite.js";
import { defineCompareOrgMetadataTool } from "./core-metadata-diff/compare-org-metadata.js";
import { definePermissionSetDiffTool } from "./core-metadata-diff/permission-set-diff.js";
import { defineRecommendPermissionSetsTool } from "./core-metadata-diff/recommend-permission-sets.js";
import { defineApexDependencyGraphTool } from "./core-apex-advanced/apex-dependency-graph.js";
import { defineApexComplianceReportTool } from "./core-apex-advanced/apex-compliance-report.js";
import { defineRefactorSuggestTool } from "./core-apex-advanced/refactor-suggest.js";
import { defineApexChangelogTool } from "./core-apex-advanced/apex-changelog.js";
import { definePredictApexPerformanceTool } from "./core-apex-advanced/predict-apex-performance.js";
import { defineFlowConditionSimulateTool } from "./core-flow/flow-condition-simulate.js";
import { defineSuggestFlowTestCasesTool } from "./core-flow/suggest-flow-test-cases.js";
import { defineRecommendSkillsForRoleTool } from "./core-recommendations/recommend-skills-for-role.js";
import { defineAnalyzeTestCoverageGapTool } from "./core-recommendations/analyze-test-coverage-gap.js";
import { defineMetricsSummaryTool } from "./core-recommendations/metrics-summary.js";
import { defineGetPrometheusMetricsTool } from "./core-recommendations/get-prometheus-metrics.js";

export interface CoreAnalysisToolDeps extends RegisterGovToolDeps {
  /** Optional. Provided by server.ts so `recommend_skills_for_role` can list skills with summaries. */
  listSkillsWithSummary?: () => Array<{ name: string; summary: string }>;
}

export function registerCoreAnalysisTools(deps: CoreAnalysisToolDeps): void {
  const { govTool, listSkillsWithSummary } = deps;

  // Register all core analysis tools using split factory functions (24 tools + 2 aliases)
  defineRepoAnalyzeTool({ govTool });
  defineApexAnalyzeTool({ govTool });
  defineLwcAnalyzeTool({ govTool });
  defineFlowAnalyzeTool({ govTool });
  definePermissionSetAnalyzeTool({ govTool });
  defineDeployOrgTool({ govTool });
  defineRunTestsTool({ govTool });
  defineRunDeploymentVerificationTool({ govTool });
  defineDeploymentPlanGenerateTool({ govTool });
  defineBenchmarkSuiteTool({ govTool });
  defineCompareOrgMetadataTool({ govTool });
  definePermissionSetDiffTool({ govTool });
  defineRecommendPermissionSetsTool({ govTool });
  defineApexDependencyGraphTool({ govTool });
  defineApexComplianceReportTool({ govTool });
  defineRefactorSuggestTool({ govTool });
  defineApexChangelogTool({ govTool });
  definePredictApexPerformanceTool({ govTool });
  defineFlowConditionSimulateTool({ govTool });
  defineSuggestFlowTestCasesTool({ govTool });
  defineRecommendSkillsForRoleTool({ govTool, listSkillsWithSummary });
  defineAnalyzeTestCoverageGapTool({ govTool });
  defineMetricsSummaryTool({ govTool });
  defineGetPrometheusMetricsTool({ govTool });
}
