import { z } from "zod";
import { checkPrReadiness } from "../../tools/pr-readiness-check.js";
import { escapeXml } from "../../core/format/escaping.js";
import type { GovTool } from "@mcp/tool-types.js";

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

export function definePrReadinessCheckTool(govTool: GovTool): void {
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
}
