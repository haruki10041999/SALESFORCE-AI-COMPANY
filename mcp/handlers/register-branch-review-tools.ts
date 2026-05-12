import type { GovTool } from "@mcp/tool-types.js";
import { defineBranchDiffSummaryTool } from "./branch-review/branch-diff-summary.js";
import { defineBranchDiffToPromptTool } from "./branch-review/branch-diff-to-prompt.js";
import { definePrReadinessCheckTool } from "./branch-review/pr-readiness-check.js";
import { defineSecurityDeltaScanTool } from "./branch-review/security-delta-scan.js";
import { defineDeploymentImpactSummaryTool } from "./branch-review/deployment-impact-summary.js";
import { defineChangedTestsSuggestTool } from "./branch-review/changed-tests-suggest.js";
import { defineCoverageEstimateTool } from "./branch-review/coverage-estimate.js";
import { defineMetadataDependencyGraphTool } from "./branch-review/metadata-dependency-graph.js";
import { defineSimulateDependencyImpactTool } from "./branch-review/simulate-dependency-impact.js";
import { defineScanSecurityRulesTool } from "./branch-review/scan-security-rules.js";

export function registerBranchReviewTools(govTool: GovTool): void {
  defineBranchDiffSummaryTool(govTool);
  defineBranchDiffToPromptTool(govTool);
  definePrReadinessCheckTool(govTool);

  defineSecurityDeltaScanTool(govTool);
  defineDeploymentImpactSummaryTool(govTool);
  defineChangedTestsSuggestTool(govTool);
  defineCoverageEstimateTool(govTool);
  defineMetadataDependencyGraphTool(govTool);
  defineSimulateDependencyImpactTool(govTool);
  defineScanSecurityRulesTool(govTool);
}

