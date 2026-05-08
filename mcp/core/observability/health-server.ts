import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Logger } from "../logging/logger.js";

export interface HealthServerOptions {
  port: number;
  logger: Logger;
  isReady: () => boolean;
  isStartupComplete: () => boolean;
}

export interface HealthServerHandle {
  port: number;
  close: () => Promise<void>;
}

export async function startHealthServer(options: HealthServerOptions): Promise<HealthServerHandle> {
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
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ status: "ok" }));
        return;
      }

      if (req.method === "GET" && req.url === "/readyz") {
        const ready = options.isReady();
        res.statusCode = ready ? 200 : 503;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ ready }));
        return;
      }

      if (req.method === "GET" && req.url === "/startupz") {
        const started = options.isStartupComplete();
        res.statusCode = started ? 200 : 503;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ started }));
        return;
      }

      res.statusCode = 404;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("not found\n");
    } catch (error) {
      options.logger.warn("health endpoint request failed", error);
      res.statusCode = 500;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("internal error\n");
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, () => {
      server.off("error", reject);
      resolve();
    });
  });

  options.logger.info(`Health HTTP endpoint listening on :${options.port}`);

  return {
    port: options.port,
    close: async () => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  };
}
