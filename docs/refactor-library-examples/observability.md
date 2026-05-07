# OpenTelemetry / Prometheus / LangSmith

## 役割

- `@opentelemetry/api`: トレース API
- `@opentelemetry/sdk-node`: SDK 起動
- `@opentelemetry/exporter-trace-otlp-http`: OTLP exporter
- `@opentelemetry/auto-instrumentations-node`: 自動計装
- `@opentelemetry/instrumentation-pg`: PostgreSQL 計装
- `prom-client`: Prometheus メトリクス
- `langsmith`: LangChain 実行トレース（任意）

## 想定適用箇所

- [mcp/core/observability/runtime.ts](../mcp/core/observability/runtime.ts)
- [mcp/core/observability/otel-tracer.ts](../mcp/core/observability/otel-tracer.ts)
- [mcp/core/observability/prometheus-metrics.ts](../mcp/core/observability/prometheus-metrics.ts)
- [mcp/bootstrap.ts](../mcp/bootstrap.ts)
- `db/client.ts`（新規）

## OTel 初期化例

```ts
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({ url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT }),
  instrumentations: [getNodeAutoInstrumentations()]
});

await sdk.start();
```

## Prometheus 例

```ts
import { Counter, Registry } from "prom-client";

const registry = new Registry();
const toolCalls = new Counter({
  name: "sfai_tool_calls_total",
  help: "Total MCP tool calls",
  registers: [registry],
  labelNames: ["tool"]
});

toolCalls.inc({ tool: "smart_chat" });
```

## LangSmith 例

```ts
process.env.LANGCHAIN_TRACING_V2 = "true";
process.env.LANGCHAIN_API_KEY = "<optional>";
```

## 注意点

- LangSmith は任意。無料構成では無効でよい
- OTel と LangSmith の二重計測は用途を分ける
- 自作 HTML ダッシュボードは段階的に Grafana に置き換える
