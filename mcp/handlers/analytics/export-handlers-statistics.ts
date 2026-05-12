import { z } from "zod";
import { executeExportHandlersStatisticsTool } from "../../core/application/analytics/services/analytics-handler-admin-tools.js";
import type { RegisterGovToolDeps } from "../types.js";

export interface DefineExportHandlersStatisticsDeps extends RegisterGovToolDeps {
  handlersState: any;
  exportStatisticsAsCsv: any;
  exportStatisticsAsJson: any;
  ensureDir: any;
}

export function defineExportHandlersStatisticsTool(deps: DefineExportHandlersStatisticsDeps): void {
  const { govTool, handlersState, exportStatisticsAsCsv, exportStatisticsAsJson, ensureDir } = deps;

  govTool(
    "export_handlers_statistics",
    {
      title: "ハンドラー統計エクスポート",
      description: "ハンドラー統計をエクスポートします。",
      inputSchema: {
        format: z.enum(["json", "csv"]).optional(),
        outputPath: z.string().optional()
      }
    },
    async ({ format, outputPath }: { format?: "json" | "csv"; outputPath?: string }) => {
      const content = await executeExportHandlersStatisticsTool({
        format,
        outputPath,
        handlersState,
        toCsv: exportStatisticsAsCsv,
        toJson: exportStatisticsAsJson,
        ensureDir
      });

      return { content: [{ type: "text", text: content }] };
    }
  );
}
