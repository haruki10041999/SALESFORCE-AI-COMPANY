import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Logger } from "../logging/logger.js";

interface RuntimeHandles {
  stop: () => Promise<void>;
}

interface NodeSdkLike {
  start: () => void | Promise<void>;
  shutdown: () => Promise<void>;
}

let activeRuntime: RuntimeHandles | null = null;

function isTruthy(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

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

async function initOtelSdk(logger: Logger): Promise<NodeSdkLike | null> {
  if (!isTruthy(process.env.OTEL_ENABLED)) {
    return null;
  }

  try {
    const sdkMod = await import("@opentelemetry/sdk-node");
    const exporterMod = await import("@opentelemetry/exporter-trace-otlp-http");

    const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318";
    const traceUrl = normalizeOtlpTraceUrl(endpoint);
    const exporter = new exporterMod.OTLPTraceExporter({ url: traceUrl });

    const sdk = new sdkMod.NodeSDK({
      serviceName: process.env.OTEL_SERVICE_NAME ?? "salesforce-ai-company",
      traceExporter: exporter
    }) as unknown as NodeSdkLike;
    await sdk.start();
    logger.info(`OTel SDK started (otlp=${traceUrl})`);
    return sdk;
  } catch (error) {
    logger.warn("OTel SDK initialization skipped", error);
    return null;
  }
}

async function initPrometheusHttp(logger: Logger): Promise<{
  close: () => Promise<void>;
  port: number;
} | null> {
  const port = parsePort(process.env.PROMETHEUS_METRICS_PORT, 0);
  if (!Number.isFinite(port) || port <= 0) {
    logger.info("Prometheus HTTP endpoint disabled (PROMETHEUS_METRICS_PORT<=0)");
    return null;
  }

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      if (req.method === "GET" && req.url === "/metrics") {
        const { getPrometheusMetricsText } = await import("./prometheus-metrics.js");
        const { contentType, text } = await getPrometheusMetricsText();
        res.statusCode = 200;
        res.setHeader("Content-Type", contentType);
        res.end(text);
        return;
      }
      if (req.method === "GET" && req.url === "/healthz") {
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end("ok\n");
        return;
      }
      res.statusCode = 404;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("not found\n");
    } catch (error) {
      logger.warn("metrics endpoint request failed", error);
      res.statusCode = 500;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("internal error\n");
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => {
      server.off("error", reject);
      resolve();
    });
  }).catch((error) => {
    logger.warn(`Prometheus HTTP endpoint could not bind :${port}`, error);
    return Promise.reject(error);
  });

  logger.info(`Prometheus HTTP endpoint listening on :${port}`);

  return {
    port,
    close: async () => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  };
}

export async function startObservabilityRuntime(logger: Logger): Promise<RuntimeHandles> {
  if (activeRuntime) {
    return activeRuntime;
  }

  const otelSdk = await initOtelSdk(logger);
  let metricsServer: Awaited<ReturnType<typeof initPrometheusHttp>> | null = null;
  try {
    metricsServer = await initPrometheusHttp(logger);
  } catch {
    metricsServer = null;
  }

  activeRuntime = {
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