import { z } from "zod";
import { summarizeBranchDiff } from "../tools/branch-diff-summary.js";
import { buildBranchDiffPrompt } from "../tools/branch-diff-to-prompt.js";
import { checkPrReadiness } from "../tools/pr-readiness-check.js";
import { scanSecurityDelta } from "../tools/security-delta-scan.js";
import { summarizeDeploymentImpact } from "../tools/deployment-impact-summary.js";
import { suggestChangedTests } from "../tools/changed-tests-suggest.js";
import type { GovTool } from "@mcp/tool-types.js";

export function registerBranchReviewTools(govTool: GovTool): void {
  govTool(
    "branch_diff_summary",
    {
      title: "Branch Diff Summary",
      description: "Auto-generated description.",
      inputSchema: {
        repoPath: z.string(),
        baseBranch: z.string(),
        workingBranch: z.string(),
        maxFiles: z.number().int().min(1).max(200).optional()
      }
    },
    async ({ repoPath, baseBranch, workingBranch, maxFiles }: {
      repoPath: string;
      baseBranch: string;
      workingBranch: string;
      maxFiles?: number;
    }) => {
      const result = summarizeBranchDiff({
        repoPath,
        integrationBranch: baseBranch,
        workingBranch,
        maxFiles: maxFiles ?? 20
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                comparison: baseBranch + "..." + workingBranch,
                filesChanged: result.filesChanged,
                added: result.added,
                modified: result.modified,
                deleted: result.deleted,
                renamed: result.renamed,
                copied: result.copied,
                fileTypeBreakdown: result.fileTypeBreakdown,
                summary: result.summary,
                fileChanges: result.fileChanges
              },
              null,
              2
            )
          }
        ]
      };
    }
  );

  govTool(
    "branch_diff_to_prompt",
    {
      title: "Branch Diff To Prompt",
      description: "Auto-generated description.",
      inputSchema: {
        repoPath: z.string(),
        baseBranch: z.string(),
        workingBranch: z.string(),
        topic: z.string().optional(),
        turns: z.number().int().min(1).max(30).optional(),
        maxHighlights: z.number().int().min(1).max(50).optional()
      }
    },
    async ({ repoPath, baseBranch, workingBranch, topic, turns, maxHighlights }: {
      repoPath: string;
      baseBranch: string;
      workingBranch: string;
      topic?: string;
      turns?: number;
      maxHighlights?: number;
    }) => {
      const result = buildBranchDiffPrompt({
        repoPath,
        integrationBranch: baseBranch,
        workingBranch,
        topic,
        turns,
        maxHighlights
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                comparison: baseBranch + "..." + workingBranch,
                recommendedAgents: result.recommendedAgents,
                summary: result.summary,
                prompt: result.prompt
              },
              null,
              2
            )
          }
        ]
      };
    }
  );

  govTool(
    "pr_readiness_check",
    {
      title: "PR Readiness Check",
      description: "Auto-generated description.",
      inputSchema: {
        repoPath: z.string(),
        baseBranch: z.string(),
        workingBranch: z.string(),
        reviewText: z.string().optional()
      }
    },
    async ({ repoPath, baseBranch, workingBranch, reviewText }: {
      repoPath: string;
      baseBranch: string;
      workingBranch: string;
      reviewText?: string;
    }) => {
      const result = checkPrReadiness({
        repoPath,
        integrationBranch: baseBranch,
        workingBranch,
        reviewText
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );

  govTool(
    "security_delta_scan",
    {
      title: "Security Delta Scan",
      description: "Auto-generated description.",
      inputSchema: {
        repoPath: z.string(),
        baseBranch: z.string(),
        workingBranch: z.string(),
        maxFindings: z.number().int().min(1).max(200).optional()
      }
    },
    async ({ repoPath, baseBranch, workingBranch, maxFindings }: {
      repoPath: string;
      baseBranch: string;
      workingBranch: string;
      maxFindings?: number;
    }) => {
      const result = scanSecurityDelta({
        repoPath,
        integrationBranch: baseBranch,
        workingBranch,
        maxFindings
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );

  govTool(
    "deployment_impact_summary",
    {
      title: "Deployment Impact Summary",
      description: "Auto-generated description.",
      inputSchema: {
        repoPath: z.string(),
        baseBranch: z.string(),
        workingBranch: z.string()
      }
    },
    async ({ repoPath, baseBranch, workingBranch }: {
      repoPath: string;
      baseBranch: string;
      workingBranch: string;
    }) => {
      const result = summarizeDeploymentImpact({
        repoPath,
        integrationBranch: baseBranch,
        workingBranch
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );

  govTool(
    "changed_tests_suggest",
    {
      title: "Changed Tests Suggest",
      description: "Auto-generated description.",
      inputSchema: {
        repoPath: z.string(),
        baseBranch: z.string(),
        workingBranch: z.string(),
        targetOrg: z.string().optional()
      }
    },
    async ({ repoPath, baseBranch, workingBranch, targetOrg }: {
      repoPath: string;
      baseBranch: string;
      workingBranch: string;
      targetOrg?: string;
    }) => {
      const result = suggestChangedTests({
        repoPath,
        integrationBranch: baseBranch,
        workingBranch,
        targetOrg
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );
}

