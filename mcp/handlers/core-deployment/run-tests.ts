import { z } from "zod";
import { buildTestCommand } from "../../tools/run-tests.js";
import type { RegisterGovToolDeps } from "../types.js";

export interface DefineRunTestsDeps extends RegisterGovToolDeps {}

export function defineRunTestsTool(deps: DefineRunTestsDeps): void {
  const { govTool } = deps;

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
}
