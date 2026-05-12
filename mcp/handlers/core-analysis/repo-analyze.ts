import { z } from "zod";
import { analyzeRepo } from "../../tools/repo-analyzer.js";
import type { RegisterGovToolDeps } from "../types.js";

export interface DefineRepoAnalyzeDeps extends RegisterGovToolDeps {}

export function defineRepoAnalyzeTool(deps: DefineRepoAnalyzeDeps): void {
  const { govTool } = deps;

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
}
