import { z } from "zod";
import { runBenchmarkSuite } from "../../tools/benchmark-suite.js";
import type { RegisterGovToolDeps } from "../types.js";

export interface DefineBenchmarkSuiteDeps extends RegisterGovToolDeps {}

export function defineBenchmarkSuiteTool(deps: DefineBenchmarkSuiteDeps): void {
  const { govTool } = deps;

  govTool(
    "benchmark_suite",
    {
      title: "ベンチマーク実行",
      description: "最近のトレースメトリクスを基に軽量ベンチマーク評価を実行します。",
      inputSchema: {
        scenarios: z.array(z.string()).optional(),
        recentTraceLimit: z.number().int().min(1).max(5000).optional()
      }
    },
    async ({ scenarios, recentTraceLimit }: { scenarios?: string[]; recentTraceLimit?: number }) => {
      const result = runBenchmarkSuite({ scenarios, recentTraceLimit });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      };
    }
  );
}
