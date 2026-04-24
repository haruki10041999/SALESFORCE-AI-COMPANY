import { z } from "zod";
import { summarizeBranchDiff } from "../tools/branch-diff-summary.js";
import { buildBranchDiffPrompt } from "../tools/branch-diff-to-prompt.js";
import { checkPrReadiness } from "../tools/pr-readiness-check.js";
import { scanSecurityDelta } from "../tools/security-delta-scan.js";
import { summarizeDeploymentImpact } from "../tools/deployment-impact-summary.js";
import { suggestChangedTests } from "../tools/changed-tests-suggest.js";
import { estimateChangedCoverage } from "../tools/coverage-estimate.js";
import { buildMetadataDependencyGraph } from "../tools/metadata-dependency-graph.js";
import type { GovTool } from "@mcp/tool-types.js";

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function readinessAsJunit(result: {
  comparison: string;
  gate: "ready" | "needs-review" | "blocked";
  checklist: Array<{ id: string; title: string; status: "pass" | "warning" | "fail"; detail: string }>;
}): string {
  const failures = result.checklist.filter((item) => item.status !== "pass");
  const testCases = result.checklist.map((item) => {
    if (item.status === "pass") {
      return `    <testcase name="${escapeXml(item.id)}" classname="pr_readiness"/>`;
    }
    return [
      `    <testcase name="${escapeXml(item.id)}" classname="pr_readiness">`,
      `      <failure message="${escapeXml(item.title)}">${escapeXml(item.detail)}</failure>`,
      "    </testcase>"
    ].join("\n");
  }).join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuite name="pr_readiness_check" tests="${result.checklist.length}" failures="${failures.length}">`,
    `  <properties><property name="comparison" value="${escapeXml(result.comparison)}"/><property name="gate" value="${result.gate}"/></properties>`,
    testCases,
    "</testsuite>"
  ].join("\n");
}

function readinessAsSarif(result: {
  comparison: string;
  gate: "ready" | "needs-review" | "blocked";
  checklist: Array<{ id: string; title: string; status: "pass" | "warning" | "fail"; detail: string }>;
}): string {
  const findings = result.checklist
    .filter((item) => item.status !== "pass")
    .map((item) => ({
      ruleId: `pr-${item.id}`,
      level: item.status === "fail" ? "error" : "warning",
      message: { text: `${item.title}: ${item.detail}` }
    }));

  return JSON.stringify(
    {
      version: "2.1.0",
      $schema: "https://json.schemastore.org/sarif-2.1.0.json",
      runs: [
        {
          tool: {
            driver: {
              name: "salesforce-ai-company/pr_readiness_check",
              informationUri: "https://github.com",
              rules: result.checklist.map((item) => ({
                id: `pr-${item.id}`,
                shortDescription: { text: item.title },
                defaultConfiguration: {
                  level: item.status === "fail" ? "error" : item.status === "warning" ? "warning" : "note"
                }
              }))
            }
          },
          invocations: [
            {
              executionSuccessful: true,
              properties: {
                comparison: result.comparison,
                gate: result.gate
              }
            }
          ],
          results: findings
        }
      ]
    },
    null,
    2
  );
}

export function registerBranchReviewTools(govTool: GovTool): void {
  govTool(
    "branch_diff_summary",
    {
      title: "ブランチ差分サマリー",
      description: "ブランチ差分の要約を生成します。",
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
        baseBranch,
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
      title: "ブランチ差分からプロンプト生成",
      description: "ブランチ差分からレビュー用プロンプトを生成します。",
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
        baseBranch,
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
      title: "PR準備状況チェック",
      description: "プルリクエストの準備状況をチェックします。",
      inputSchema: {
        repoPath: z.string(),
        baseBranch: z.string(),
        workingBranch: z.string(),
        reviewText: z.string().optional(),
        format: z.enum(["json", "junit", "sarif"]).optional()
      }
    },
    async ({ repoPath, baseBranch, workingBranch, reviewText, format }: {
      repoPath: string;
      baseBranch: string;
      workingBranch: string;
      reviewText?: string;
      format?: "json" | "junit" | "sarif";
    }) => {
      const result = checkPrReadiness({
        repoPath,
        baseBranch,
        workingBranch,
        reviewText
      });

      if (format === "junit") {
        return {
          content: [{ type: "text", text: readinessAsJunit(result) }]
        };
      }

      if (format === "sarif") {
        return {
          content: [{ type: "text", text: readinessAsSarif(result) }]
        };
      }

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );

  govTool(
    "security_delta_scan",
    {
      title: "セキュリティ差分スキャン",
      description: "差分に対するセキュリティ観点のスキャンを実行します。",
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
        baseBranch,
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
      title: "デプロイ影響サマリー",
      description: "変更がデプロイに与える影響を要約します。",
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
        baseBranch,
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
      title: "変更テスト提案",
      description: "変更内容に応じたテスト候補を提案します。",
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
        baseBranch,
        workingBranch,
        targetOrg
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );

  govTool(
    "coverage_estimate",
    {
      title: "カバレッジ推定",
      description: "変更されたソースファイルに対する想定テストカバレッジを推定します。",
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
      const result = estimateChangedCoverage({
        repoPath,
        baseBranch,
        workingBranch,
        targetOrg
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );

  govTool(
    "metadata_dependency_graph",
    {
      title: "メタデータ依存グラフ",
      description: "変更されたオブジェクトおよび項目のメタデータ依存関係を検出します。",
      inputSchema: {
        repoPath: z.string(),
        baseBranch: z.string(),
        workingBranch: z.string(),
        maxReferences: z.number().int().min(1).max(200).optional()
      }
    },
    async ({ repoPath, baseBranch, workingBranch, maxReferences }: {
      repoPath: string;
      baseBranch: string;
      workingBranch: string;
      maxReferences?: number;
    }) => {
      const result = buildMetadataDependencyGraph({
        repoPath,
        baseBranch,
        workingBranch,
        maxReferences
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );
}

