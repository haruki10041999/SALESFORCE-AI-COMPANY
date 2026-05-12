import { z } from "zod";
import { diffPermissionSet } from "../../tools/permission-set-diff.js";
import type { RegisterGovToolDeps } from "../types.js";

export interface DefinePermissionSetDiffDeps extends RegisterGovToolDeps {}

export function definePermissionSetDiffTool(deps: DefinePermissionSetDiffDeps): void {
  const { govTool } = deps;

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

  // Compatibility alias: task name used in planning docs
  govTool(
    "compare_permission_sets",
    {
      title: "Permission Set差分検出 (alias)",
      description: "permission_set_diff の互換エイリアスです。",
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
      const result = diffPermissionSet({ baselineFilePath, targetFilePath, sampleLimit });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );
}
