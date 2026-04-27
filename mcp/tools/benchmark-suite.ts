import { summarizeMetrics } from "./metrics-summary.js";

export type BenchmarkSuiteInput = {
  scenarios?: string[];
  recentTraceLimit?: number;
  /**
   * TASK-F9: when true and `scenarios` is empty, use the function provided in
   * `loadRegisteredScenarios` to populate the benchmark targets. The default
   * implementation passed by the CLI reads `outputs/tool-catalog.json`
   * (produced by `npm run tools:catalog`) so new tools are picked up without
   * editing this file.
   */
  useRegisteredTools?: boolean;
  loadRegisteredScenarios?: () => string[];
};

export type BenchmarkCaseResult = {
  scenario: string;
  score: number;
  note: string;
};

export type BenchmarkSuiteResult = {
  overallScore: number;
  grade: "A" | "B" | "C" | "D";
  metricsSnapshot: {
    successRate: number;
    errorRate: number;
    averageDurationMs: number;
    p95DurationMs: number;
  };
  cases: BenchmarkCaseResult[];
  recommendations: string[];
};

function toGrade(score: number): "A" | "B" | "C" | "D" {
  if (score >= 90) return "A";
  if (score >= 75) return "B";
  if (score >= 60) return "C";
  return "D";
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export function runBenchmarkSuite(input: BenchmarkSuiteInput = {}): BenchmarkSuiteResult {
  const explicit = input.scenarios ?? [];
  let scenarios: string[];
  if (explicit.length > 0) {
    scenarios = explicit;
  } else if (input.useRegisteredTools && input.loadRegisteredScenarios) {
    const fromRegistry = input.loadRegisteredScenarios();
    scenarios = fromRegistry.length > 0
      ? fromRegistry
      : ["Apex review", "LWC optimization", "Security delta scan", "Release readiness"];
  } else {
    scenarios = [
      "Apex review",
      "LWC optimization",
      "Security delta scan",
      "Release readiness"
    ];
  }

  const metrics = summarizeMetrics({ limit: input.recentTraceLimit ?? 300 });

  const reliabilityScore = clamp(Math.round((1 - metrics.errorRate) * 100), 0, 100);
  const latencyScore = clamp(Math.round(100 - metrics.p95DurationMs / 50), 0, 100);
  const throughputScore = clamp(Math.round(100 - metrics.averageDurationMs / 25), 0, 100);

  const baseScore = Math.round((reliabilityScore * 0.5) + (latencyScore * 0.3) + (throughputScore * 0.2));

  const cases: BenchmarkCaseResult[] = scenarios.map((scenario, idx) => {
    const scenarioScore = clamp(baseScore - idx * 2, 0, 100);
    const note = scenarioScore >= 80
      ? "安定"
      : scenarioScore >= 65
        ? "改善余地あり"
        : "要改善";
    return { scenario, score: scenarioScore, note };
  });

  const overallScore = cases.length === 0
    ? baseScore
    : Math.round(cases.reduce((sum, c) => sum + c.score, 0) / cases.length);

  const recommendations: string[] = [];
  if (metrics.errorRate > 0.1) {
    recommendations.push("失敗率が高めです。retry 設定と外部依存のタイムアウト見直しを推奨します。");
  }
  if (metrics.p95DurationMs > 2000) {
    recommendations.push("p95 遅延が高いです。重いツールの分割またはキャッシュ拡張を検討してください。");
  }
  if (recommendations.length === 0) {
    recommendations.push("現状は良好です。定期的な負荷ベンチを CI に組み込むと品質を維持できます。");
  }

  return {
    overallScore,
    grade: toGrade(overallScore),
    metricsSnapshot: {
      successRate: metrics.successRate,
      errorRate: metrics.errorRate,
      averageDurationMs: metrics.averageDurationMs,
      p95DurationMs: metrics.p95DurationMs
    },
    cases,
    recommendations
  };
}
