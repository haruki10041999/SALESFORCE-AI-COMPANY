import { z } from "zod";
import { executeApexComplianceReport } from "../../core/application/analysis/services/apex-compliance-report-service.js";
import type { RegisterGovToolDeps } from "../types.js";

export interface DefineApexComplianceReportDeps extends RegisterGovToolDeps {}

export function defineApexComplianceReportTool(deps: DefineApexComplianceReportDeps): void {
  const { govTool } = deps;

  govTool(
    "apex_compliance_report",
    {
      title: "Apex 統合コンプライアンスレポート",
      description: "指定 rootDir 配下の Apex を一括スキャンし、依存グラフ + セキュリティ違反 + パフォーマンスリスクを 1 つの統合レポートにまとめます。CI のゲートや PR コメント生成に利用できます。",
      inputSchema: {
        rootDir: z.string(),
        includeTests: z.boolean().optional(),
        sampleLimit: z.number().int().min(1).max(500).optional()
      }
    },
    async ({ rootDir, includeTests, sampleLimit }: {
      rootDir: string;
      includeTests?: boolean;
      sampleLimit?: number;
    }) => {
      const report = executeApexComplianceReport({
        rootDir,
        includeTests,
        sampleLimit
      });
      return {
        content: [{ type: "text", text: JSON.stringify(report, null, 2) }]
      };
    }
  );
}
