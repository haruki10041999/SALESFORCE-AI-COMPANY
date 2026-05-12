import type { Logger } from "../logging/logger.js";
import { parseBooleanLike } from "../config/env-flags.js";
import {
  getLangSmithEnabled,
  getOtelEnabled,
  getOtelExporterEndpoint,
  getOtelServiceName,
  getPrometheusMetricsPort,
  setLangchainTracingV2Enabled
} from "../config/runtime-config.js";
import { startHealthServer } from "./health-server.js";
import { circuitBreakerRegistry } from "../reliability/circuit-breaker.js";
import { bulkheadRegistry, DEFAULT_EXTERNAL_HTTP_CONCURRENCY } from "../reliability/bulkhead.js";

interface RuntimeHandles {
  stop: () => Promise<void>;
  setReady: (ready: boolean) => void;
  setStartupComplete: (started: boolean) => void;
}

interface NodeSdkLike {
  start: () => void | Promise<void>;
  shutdown: () => Promise<void>;
}

let activeRuntime: RuntimeHandles | null = null;

function parsePort(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function normalizeOtlpTraceUrl(endpoint: string): string {
  const trimmed = endpoint.trim();
  if (trimmed.endsWith("/v1/traces")) return trimmed;
  if (trimmed.endsWith("/")) return `${trimmed}v1/traces`;
  return `${trimmed}/v1/traces`;
}

function applyLangSmithToggle(logger: Logger): void {
  const enabled = getLangSmithEnabled();
  if (enabled) {
    setLangchainTracingV2Enabled(true);
    logger.info("LangSmith tracing enabled (SF_AI_LANGSMITH_ENABLED=true)");
    return;
  }

  // Keep LangSmith explicitly opt-in so default runs remain local-only.
  setLangchainTracingV2Enabled(false);
}

async function initOtelSdk(logger: Logger): Promise<NodeSdkLike | null> {
  if (!getOtelEnabled()) {
    return null;
  }

  try {
    const otelBulkhead = bulkheadRegistry.get("otlp-exporter", {
      concurrency: DEFAULT_EXTERNAL_HTTP_CONCURRENCY,
      maxQueue: 20
    });
    const otelCircuit = circuitBreakerRegistry.get("otlp-exporter", {
      failureRateThreshold: 0.5,
      minCallsInWindow: 3,
      cooldownMs: 15_000,
      windowSize: 10,
      halfOpenSuccessThreshold: 1
    });

    const sdkMod = await import("@opentelemetry/sdk-node");
    const exporterMod = await import("@opentelemetry/exporter-trace-otlp-http");
    const autoMod = await import("@opentelemetry/auto-instrumentations-node");
    const pgMod = await import("@opentelemetry/instrumentation-pg");

    const endpoint = getOtelExporterEndpoint();
    const traceUrl = normalizeOtlpTraceUrl(endpoint);
    const exporter = new exporterMod.OTLPTraceExporter({ url: traceUrl });
    const instrumentations = [
      autoMod.getNodeAutoInstrumentations(),
      new pgMod.PgInstrumentation()
    ];

    const sdk = new sdkMod.NodeSDK({
      serviceName: getOtelServiceName(),
      traceExporter: exporter,
      instrumentations
    }) as unknown as NodeSdkLike;
    await otelBulkhead.execute(async () => otelCircuit.execute(async () => {
      await sdk.start();
      return undefined;
    }));
    logger.info(`OTel SDK started (otlp=${traceUrl})`);
    return sdk;
  } catch (error) {
    logger.warn("OTel SDK initialization skipped", error);
    return null;
  }
}

async function initPrometheusHttp(
  logger: Logger,
  readiness: { isReady: () => boolean; isStartupComplete: () => boolean }
): Promise<{
  close: () => Promise<void>;
  port: number;
} | null> {
  const port = parsePort(String(getPrometheusMetricsPort(0)), 0);
  if (!Number.isFinite(port) || port <= 0) {
    logger.info("Prometheus HTTP endpoint disabled (PROMETHEUS_METRICS_PORT<=0)");
    return null;
  }

  const handle = await startHealthServer({
    port,
    logger,
    isReady: readiness.isReady,
    isStartupComplete: readiness.isStartupComplete
  }).catch((error) => {
    logger.warn(`Prometheus HTTP endpoint could not bind :${port}`, error);
    return Promise.reject(error);
  });

  return {
    port: handle.port,
    close: async () => {
      await handle.close();
    }
  };
}

export async function startObservabilityRuntime(logger: Logger): Promise<RuntimeHandles> {
  if (activeRuntime) {
    return activeRuntime;
  }

  applyLangSmithToggle(logger);

  let ready = false;
  let startupComplete = false;

  const otelSdk = await initOtelSdk(logger);
  let metricsServer: Awaited<ReturnType<typeof initPrometheusHttp>> | null = null;
  try {
    metricsServer = await initPrometheusHttp(logger, {
      isReady: () => ready,
      isStartupComplete: () => startupComplete
    });
  } catch {
    metricsServer = null;
  }
  startupComplete = true;

  activeRuntime = {
    setReady: (value: boolean) => {
      ready = value;
    },
    setStartupComplete: (value: boolean) => {
      startupComplete = value;
    },
    stop: async () => {
      if (metricsServer) {
        await metricsServer.close();
        logger.info("Prometheus HTTP endpoint stopped");
      }
      if (otelSdk) {
        await otelSdk.shutdown();
        logger.info("OTel SDK stopped");
      }
      activeRuntime = null;
    }
  };

  return activeRuntime;
}