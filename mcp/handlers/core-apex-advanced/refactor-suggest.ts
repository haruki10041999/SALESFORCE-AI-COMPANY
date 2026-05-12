import { z } from "zod";
import { suggestRefactors } from "../../tools/refactor-suggest.js";
import type { RegisterGovToolDeps } from "../types.js";

export interface DefineRefactorSuggestDeps extends RegisterGovToolDeps {}

export function defineRefactorSuggestTool(deps: DefineRefactorSuggestDeps): void {
  const { govTool } = deps;

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
}
