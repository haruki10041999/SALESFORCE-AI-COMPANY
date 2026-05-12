import { z } from "zod";
import { suggestFlowTestCases } from "../../tools/suggest-flow-test-cases.js";
import type { RegisterGovToolDeps } from "../types.js";

export interface DefineSuggestFlowTestCasesDeps extends RegisterGovToolDeps {}

export function defineSuggestFlowTestCasesTool(deps: DefineSuggestFlowTestCasesDeps): void {
  const { govTool } = deps;

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
}
