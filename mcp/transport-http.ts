import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { Logger } from "./core/logging/logger.js";
import { resolveActorFromOidcInput } from "./core/identity/oidc-verifier.js";
import { runWithRequestContext } from "./core/runtime/request-context.js";
import { ReplayReader } from "./core/persistence/replay-reader.js";
import { getReplayDeterminismMode, getReplayRequireLlmCacheHit } from "./core/config/runtime-config.js";

interface ConnectableServer {
  connect: (transport: Transport) => Promise<void>;
}

interface StartMcpHttpTransportOptions {
  server: ConnectableServer;
  logger: Logger;
  env?: NodeJS.ProcessEnv;
}

interface HttpRateLimitState {
  windowStartMs: number;
  count: number;
}

function getHttpHost(env: NodeJS.ProcessEnv): string {
  return (env.MCP_HTTP_HOST ?? "127.0.0.1").trim();
}

function getHttpPort(env: NodeJS.ProcessEnv): number {
  const raw = (env.MCP_HTTP_PORT ?? "3800").trim();
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error(`MCP_HTTP_PORT must be an integer between 1 and 65535 (received: ${raw})`);
  }
  return parsed;
}

function getAllowedOrigin(env: NodeJS.ProcessEnv): string {
  return (env.MCP_HTTP_CORS_ORIGIN ?? "*").trim();
}

function getRateLimitPerMinute(env: NodeJS.ProcessEnv): number {
  const raw = (env.MCP_HTTP_RATE_LIMIT_PER_MIN ?? "120").trim();
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`MCP_HTTP_RATE_LIMIT_PER_MIN must be a positive integer (received: ${raw})`);
  }
  return parsed;
}

function getClientKey(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded && forwarded.trim().length > 0) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = req.headers.get("x-real-ip");
  if (realIp && realIp.trim().length > 0) return realIp.trim();
  return "unknown";
}

export async function startMcpHttpTransport(options: StartMcpHttpTransportOptions): Promise<void> {
  const env = options.env ?? process.env;
  const host = getHttpHost(env);
  const port = getHttpPort(env);
  const allowedOrigin = getAllowedOrigin(env);
  const maxPerMinute = getRateLimitPerMinute(env);

  const app = new Hono();
  const sessionTransports = new Map<string, WebStandardStreamableHTTPServerTransport>();
  const rateLimitMap = new Map<string, HttpRateLimitState>();

  function resolveTransportRequestContext(req: Request): {
    tenantId: string;
    actorId: string;
    traceId: string;
    sessionId?: string;
    reasonCode?: string;
  } {
    const tenantId =
      req.headers.get("x-tenant-id")
      ?? req.headers.get("sf-ai-tenant-id")
      ?? "global";
    const actorId =
      req.headers.get("x-actor-id")
      ?? req.headers.get("sf-ai-actor-id")
      ?? "transport-http";
    const traceId =
      req.headers.get("x-trace-id")
      ?? req.headers.get("traceparent")
      ?? randomUUID();
    const sessionId = req.headers.get("mcp-session-id") ?? undefined;

    return {
      tenantId,
      actorId,
      traceId,
      ...(sessionId ? { sessionId } : {}),
      reasonCode: "http-transport"
    };
  }

  app.use(
    "*",
    cors({
      origin: allowedOrigin,
      allowHeaders: ["content-type", "mcp-session-id", "mcp-protocol-version", "authorization", "last-event-id"],
      allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
      maxAge: 600
    })
  );

  app.use("/mcp", async (c, next) => {
    const key = getClientKey(c.req.raw);
    const now = Date.now();
    const state = rateLimitMap.get(key);
    if (!state || now - state.windowStartMs >= 60_000) {
      rateLimitMap.set(key, { windowStartMs: now, count: 1 });
      await next();
      return;
    }

    if (state.count >= maxPerMinute) {
      c.header("Retry-After", "60");
      return c.json(
        {
          jsonrpc: "2.0",
          error: {
            code: -32029,
            message: `HTTP rate limit exceeded: max ${maxPerMinute} requests/min`
          },
          id: null
        },
        429
      );
    }

    state.count += 1;
    await next();
  });

  app.use("/mcp", async (c, next) => {
    const authMode = (env.SF_AI_AUTH_MODE ?? "disabled").toLowerCase();
    if (authMode !== "jwt") {
      await next();
      return;
    }

    const authorization = c.req.header("authorization") ?? c.req.header("Authorization");
    try {
      await resolveActorFromOidcInput({ authorization }, env);
      await next();
      return;
    } catch (error) {
      options.logger.warn("HTTP auth failed", error);
      return c.json(
        {
          jsonrpc: "2.0",
          error: {
            code: -32001,
            message: "Unauthorized"
          },
          id: null
        },
        401
      );
    }
  });

  app.post("/mcp", async (c) => {
    const body = await c.req.json().catch(() => undefined);
    const sessionId = c.req.header("mcp-session-id");

    let transport: WebStandardStreamableHTTPServerTransport | undefined;
    if (sessionId) {
      transport = sessionTransports.get(sessionId);
      if (!transport) {
        return c.json(
          {
            jsonrpc: "2.0",
            error: {
              code: -32000,
              message: `Session not found: ${sessionId}`
            },
            id: null
          },
          404
        );
      }
    } else if (isInitializeRequest(body)) {
      const nextTransport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (createdSessionId) => {
          sessionTransports.set(createdSessionId, nextTransport);
        },
        onsessionclosed: (closedSessionId) => {
          sessionTransports.delete(closedSessionId);
        }
      });
      nextTransport.onclose = () => {
        const closingSessionId = nextTransport.sessionId;
        if (closingSessionId) {
          sessionTransports.delete(closingSessionId);
        }
      };
      await options.server.connect(nextTransport);
      transport = nextTransport;
    } else {
      return c.json(
        {
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Missing MCP session. Send initialize first."
          },
          id: null
        },
        400
      );
    }

    return runWithRequestContext(resolveTransportRequestContext(c.req.raw), () =>
      transport.handleRequest(c.req.raw, { parsedBody: body })
    );
  });

  app.get("/mcp", async (c) => {
    const sessionId = c.req.header("mcp-session-id");
    if (!sessionId) {
      return c.json(
        {
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "mcp-session-id header is required"
          },
          id: null
        },
        400
      );
    }
    const transport = sessionTransports.get(sessionId);
    if (!transport) {
      return c.json(
        {
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: `Session not found: ${sessionId}`
          },
          id: null
        },
        404
      );
    }
    return runWithRequestContext(resolveTransportRequestContext(c.req.raw), () =>
      transport.handleRequest(c.req.raw)
    );
  });

  app.delete("/mcp", async (c) => {
    const sessionId = c.req.header("mcp-session-id");
    if (!sessionId) {
      return c.json(
        {
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "mcp-session-id header is required"
          },
          id: null
        },
        400
      );
    }
    const transport = sessionTransports.get(sessionId);
    if (!transport) {
      return c.json(
        {
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: `Session not found: ${sessionId}`
          },
          id: null
        },
        404
      );
    }
    return runWithRequestContext(resolveTransportRequestContext(c.req.raw), () =>
      transport.handleRequest(c.req.raw)
    );
  });

  // -------------------------------------------------------------------------
  // Replay Debugger read-only REST API (TASK-15)
  // Only available when DATABASE_URL is configured.
  // -------------------------------------------------------------------------
  const replayReader = env.DATABASE_URL?.trim()
    ? ReplayReader.create({
        databaseUrl: env.DATABASE_URL.trim(),
        replayMode: getReplayDeterminismMode("observe", env),
        requireLlmCacheHit: getReplayRequireLlmCacheHit(false, env)
      })
    : null;

  app.get("/replay/streams", async (c) => {
    if (!replayReader) return c.json({ error: "Replay API requires DATABASE_URL" }, 503);
    const prefix = c.req.query("prefix") ?? "";
    const tenantId = c.req.query("tenantId");
    const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
    const since = c.req.query("since");
    const streams = await replayReader.listStreams({ prefix, tenantId, limit, since });
    return c.json({ streams });
  });

  app.get("/replay/timeline/:sessionId", async (c) => {
    if (!replayReader) return c.json({ error: "Replay API requires DATABASE_URL" }, 503);
    const sessionId = c.req.param("sessionId");
    const tenantId = c.req.query("tenantId");
    const limit = Math.min(Number(c.req.query("limit") ?? 200), 1000);
    const result = await replayReader.sessionTimeline(sessionId, { tenantId, limit });
    return c.json(result);
  });

  app.get("/replay/stream/:streamId/events", async (c) => {
    if (!replayReader) return c.json({ error: "Replay API requires DATABASE_URL" }, 503);
    const streamId = decodeURIComponent(c.req.param("streamId"));
    const tenantId = c.req.query("tenantId");
    const fromVersion = Number(c.req.query("fromVersion") ?? 0);
    const limit = Math.min(Number(c.req.query("limit") ?? 500), 500);
    const events = await replayReader.readStream(streamId, { tenantId, fromVersion, limit });
    return c.json({ streamId, events });
  });

  app.get("/replay/stream/:streamId/diff", async (c) => {
    if (!replayReader) return c.json({ error: "Replay API requires DATABASE_URL" }, 503);
    const streamId = decodeURIComponent(c.req.param("streamId"));
    const tenantId = c.req.query("tenantId");
    const result = await replayReader.streamDiff(streamId, { tenantId });
    return c.json(result);
  });

  const httpServer = serve({
    fetch: app.fetch,
    hostname: host,
    port
  });

  options.logger.info(`MCP HTTP transport listening on http://${host}:${port}/mcp`);

  await new Promise<void>((resolve) => {
    const shutdown = () => {
      options.logger.info("Stopping MCP HTTP transport");
      httpServer.close(() => resolve());
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
}
