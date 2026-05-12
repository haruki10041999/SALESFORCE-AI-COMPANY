import { z } from "zod";
import { predictApexPerformance } from "../../tools/apex-perf-predict.js";
import type { RegisterGovToolDeps } from "../types.js";

export interface DefinePredictApexPerformanceDeps extends RegisterGovToolDeps {}

export function definePredictApexPerformanceTool(deps: DefinePredictApexPerformanceDeps): void {
  const { govTool } = deps;

  govTool(
    "predict_apex_performance",
    {
      title: "Apex 性能予測",
      description: "Apex ソースをヒューリスティックに走査し、SOQL/DML in loop などガバナ違反リスクをスコアします。",
      inputSchema: {
        files: z.array(z.object({
          filePath: z.string().min(1),
          source: z.string()
        })).min(1).max(500)
      }
    },
    async ({ files }: { files: Array<{ filePath: string; source: string }> }) => {
      const result = predictApexPerformance(files);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );
}
