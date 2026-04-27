/**
 * T-OBS-01: OpenTelemetry tracing wiring
 *
 * `mcp/core/trace/trace-context.ts` の startTrace/endTrace/failTrace に
 * フックして、OTel スパンを発行する薄いアダプタ。
 *
 * 設計方針:
 *  - グローバル副作用最小化: NodeSDK の自動起動はしない (env トリガで opt-in)
 *  - dynamic import で `@opentelemetry/api` 未導入環境でも no-op
 *  - traceId は MCP 内部の活性 trace ID と OTel spanId を 1:1 でマップ
 *  - exporter 設定 (OTLP HTTP) は別 module で初期化される想定
 *    (本ファイルは tracer の取得とスパン制御のみに責務限定)
 *
 * 環境変数:
 *  - OTEL_ENABLED=true で有効化 (既定 false)
 *  - OTEL_SERVICE_NAME=salesforce-ai-company (既定)
 */

import { createLogger } from "../logging/logger.js";

const logger = createLogger("OtelTracer");

interface OtelSpan {
  end(): void;
  setStatus(status: { code: number; message?: string }): void;
  setAttribute(key: string, value: string | number | boolean): void;
  recordException(error: unknown): void;
}

interface OtelTracer {
  startSpan(name: string, options?: { attributes?: Record<string, string | number | boolean> }): OtelSpan;
}

interface OtelApi {
  trace: { getTracer(name: string, version?: string): OtelTracer };
  SpanStatusCode: { OK: number; ERROR: number };
}

let api: OtelApi | null = null;
let tracer: OtelTracer | null = null;
let initAttempted = false;
const activeSpans = new Map<string, OtelSpan>();

function isEnabled(): boolean {
  return (process.env.OTEL_ENABLED ?? "false").toLowerCase() === "true";
}

async function getTracer(): Promise<OtelTracer | null> {
  if (!isEnabled()) return null;
  if (tracer) return tracer;
  if (initAttempted) return null;
  initAttempted = true;
  try {
    api = (await import("@opentelemetry/api")) as unknown as OtelApi;
    tracer = api.trace.getTracer(process.env.OTEL_SERVICE_NAME ?? "salesforce-ai-company");
    return tracer;
  } catch (err) {
    logger.debug("opentelemetry not available, otel tracing disabled", err);
    return null;
  }
}

/** トレース開始時に呼ぶ。span 起点を作成して内部マップへ記録 */
export function notifyOtelTraceStart(traceId: string, toolName: string, attrs: Record<string, string | number | boolean> = {}): void {
  void getTracer().then((t) => {
    if (!t) return;
    try {
      const span = t.startSpan(`tool.${toolName}`, {
        attributes: {
          "sfai.tool_name": toolName,
          "sfai.trace_id": traceId,
          ...attrs
        }
      });
      activeSpans.set(traceId, span);
    } catch (err) {
      logger.debug("otel startSpan failed", err);
    }
  });
}

/** トレース正常終了時に呼ぶ */
export function notifyOtelTraceEnd(traceId: string, attrs: Record<string, string | number | boolean> = {}): void {
  const span = activeSpans.get(traceId);
  if (!span) return;
  try {
    for (const [k, v] of Object.entries(attrs)) span.setAttribute(k, v);
    if (api) span.setStatus({ code: api.SpanStatusCode.OK });
  } finally {
    span.end();
    activeSpans.delete(traceId);
  }
}

/** トレース異常終了時に呼ぶ */
export function notifyOtelTraceFail(traceId: string, error: unknown): void {
  const span = activeSpans.get(traceId);
  if (!span) return;
  try {
    span.recordException(error);
    if (api) {
      span.setStatus({
        code: api.SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  } finally {
    span.end();
    activeSpans.delete(traceId);
  }
}

/** テスト用: 内部状態をリセット */
export function _resetOtelTracerForTest(): void {
  for (const span of activeSpans.values()) {
    try {
      span.end();
    } catch {
      // ignore
    }
  }
  activeSpans.clear();
  tracer = null;
  initAttempted = false;
}
