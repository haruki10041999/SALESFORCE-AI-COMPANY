import { z } from "zod";
import { promises as fsPromises } from "fs";
import { join, resolve } from "path";
import {
  buildAbHistoryAnalysis,
  parseAbHistoryRuns
} from "../../core/application/analytics/services/analytics-ab-history.js";
import { persistAbHistoryAnalysis } from "../../core/application/analytics/services/analytics-ab-history-output.js";
import type { OutputsPort } from "../../core/ports/outputs-port.js";
import type { RegisterGovToolDeps } from "../types.js";

export interface DefineAnalyzeAbTestHistoryDeps extends RegisterGovToolDeps {
  outputsDir: string;
  outputsPort: OutputsPort;
}

export function defineAnalyzeAbTestHistoryTool(deps: DefineAnalyzeAbTestHistoryDeps): void {
  const { govTool, outputsDir, outputsPort } = deps;

  govTool(
    "analyze_ab_test_history",
    {
      title: "A/Bテスト履歴分析",
      description: "agent_ab_test の runs.jsonl を集計して勝率と品質傾向を分析します。",
      inputSchema: {
        reportDir: z.string().optional(),
        minRuns: z.number().int().min(1).max(1000).optional()
      }
    },
    async ({ reportDir, minRuns }: { reportDir?: string; minRuns?: number }) => {
      try {
        const dir = reportDir ? resolve(reportDir) : resolve(outputsDir, "reports", "agent-ab-test");
        const runsPath = join(dir, "runs.jsonl");

        try {
          await fsPromises.access(runsPath);
        } catch {
          return {
            content: [{
              type: "text",
              text: JSON.stringify({ error: `No AB test history found at ${runsPath}` }, null, 2)
            }]
          };
        }

          const runsContent = await fsPromises.readFile(runsPath, "utf-8");
          const runs = parseAbHistoryRuns(runsContent);
        const analysisPath = join(dir, "analysis-latest.json");
          const { payload, view } = buildAbHistoryAnalysis({
            runs,
            minRuns,
            runsPath
          });

          await persistAbHistoryAnalysis({
            reportDir,
            analysisPath,
            payload,
            writeArtifactJson: async (path, payloadToWrite) => {
              await outputsPort.writeArtifact(path, `${JSON.stringify(payloadToWrite, null, 2)}\n`, {
                contentType: "application/json"
              });
            }
          });

        return {
          content: [{
            type: "text",
              text: JSON.stringify(
                {
                  ...view,
                  analysisPath: reportDir ? analysisPath : "reports/agent-ab-test/analysis-latest.json"
                },
                null,
                2
              )
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({ error: String(error) }, null, 2)
          }]
        };
      }
    }
  );
}
