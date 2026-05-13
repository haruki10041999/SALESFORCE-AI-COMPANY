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
 *  - PII redaction: 全 span attributes は自動的に redact (email/phone/token/SSN など)
 *
 * 環境変数:
 *  - OTEL_ENABLED=true で有効化 (既定 false)
 *  - OTEL_SERVICE_NAME=salesforce-ai-company (既定)
 *  - OTEL_TRACES_SAMPLER_RATIO=0.1 (10% sampling, 既定)
 *  - OTEL_PII_REDACTION_ENABLED=true (既定, PII redaction を有効化)
 */

import { createLogger } from "../logging/logger.js";
import { isEnvFlagEnabled } from "../config/env-flags.js";
import { getOtelServiceName, getOtelTraceSampleRatio } from "../config/runtime-config.js";
import { redactSpanAttributes } from "./pii-redactor.js";
import { recordTraceSamplingForPrometheus } from "./prometheus-metrics.js";

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
let contextManagerInitialized = false;
const activeSpans = new Map<string, OtelSpan>();

function hashTraceId(traceId: string): number {
  let hash = 0;
  for (let index = 0; index < traceId.length; index += 1) {
    hash = (hash * 31 + traceId.charCodeAt(index)) >>> 0;
  }
  return hash;
}

export function shouldSampleOtelTrace(traceId: string, sampleRatio = getOtelTraceSampleRatio()): boolean {
  if (sampleRatio <= 0) {
    return false;
  }
  if (sampleRatio >= 1) {
    return true;
  }
  const bucket = hashTraceId(traceId) / 0xffffffff;
  return bucket < sampleRatio;
}

function isEnabled(): boolean {
  return isEnvFlagEnabled("OTEL_ENABLED");
}

async function getTracer(): Promise<OtelTracer | null> {
  if (!isEnabled()) return null;
  if (tracer) return tracer;
  if (initAttempted) return null;
  initAttempted = true;
  try {
    api = (await import("@opentelemetry/api")) as unknown as OtelApi;
    if (!contextManagerInitialized) {
      try {
        const otelApi = await import("@opentelemetry/api");
        const { AsyncLocalStorageContextManager } = await import("@opentelemetry/context-async-hooks");
        otelApi.context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
        contextManagerInitialized = true;
      } catch (ctxErr) {
        logger.debug("otel context manager setup skipped", ctxErr);
      }
    }
    tracer = api.trace.getTracer(getOtelServiceName());
    return tracer;
  } catch (err) {
    logger.debug("opentelemetry not available, otel tracing disabled", err);
    return null;
  }
}

/** トレース開始時に呼ぶ。span 起点を作成して内部マップへ記録 */
export function notifyOtelTraceStart(traceId: string, toolName: string, attrs: Record<string, string | number | boolean> = {}): void {
  const shouldSample = shouldSampleOtelTrace(traceId);
  
  // Record sampling decision to Prometheus
  recordTraceSamplingForPrometheus(toolName, shouldSample);
  
  if (!shouldSample) {
    return;
  }
  void getTracer().then((t) => {
    if (!t) return;
    try {
      // Redact all attributes before setting on span
      const redactedAttrs = redactSpanAttributes(attrs);
      
      const span = t.startSpan(`tool.${toolName}`, {
        attributes: {
          "sfai.tool_name": toolName,
          "sfai.trace_id": traceId,
          ...redactedAttrs
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
    // Redact all attributes before setting on span
    const redactedAttrs = redactSpanAttributes(attrs);
    for (const [k, v] of Object.entries(redactedAttrs)) span.setAttribute(k, v);
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
