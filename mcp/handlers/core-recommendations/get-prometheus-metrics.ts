import { z } from "zod";
import type { RegisterGovToolDeps } from "../types.js";

export interface DefineGetPrometheusMetricsDeps extends RegisterGovToolDeps {}

export function defineGetPrometheusMetricsTool(deps: DefineGetPrometheusMetricsDeps): void {
  const { govTool } = deps;

  govTool(
    "get_prometheus_metrics",
    {
      title: "Prometheus メトリクス取得",
      description:
        "ツール実行回数 / レイテンシ histogram / 失敗回数を Prometheus text format で返します。Grafana / Prometheus サーバの scrape target として利用できます。",
      inputSchema: {}
    },
    async () => {
      const { getPrometheusMetricsText } = await import("../../core/observability/prometheus-metrics.js");
      const { contentType, text } = await getPrometheusMetricsText();
      return {
        content: [
          { type: "text", text: text.length > 0 ? text : "# prom-client unavailable\n" },
          { type: "text", text: `# content-type: ${contentType}` }
        ]
      };
    }
  );
}
