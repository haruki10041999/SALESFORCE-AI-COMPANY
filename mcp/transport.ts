import { connectServerWithStdio } from "./bootstrap.js";
import { startMcpHttpTransport } from "./transport-http.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { Logger } from "./core/logging/logger.js";

interface ConnectableServer {
  connect: (transport: Transport) => Promise<void>;
}

export type McpTransportKind = "stdio" | "http";

export function resolveMcpTransportKind(env: NodeJS.ProcessEnv = process.env): McpTransportKind {
  const raw = (env.MCP_TRANSPORT ?? "stdio").trim().toLowerCase();
  if (raw === "stdio" || raw === "http") {
    return raw;
  }
  throw new Error(`MCP_TRANSPORT must be either 'stdio' or 'http' (received: ${raw})`);
}

export async function startMcpTransport(server: ConnectableServer, logger: Logger): Promise<void> {
  const transportKind = resolveMcpTransportKind(process.env);
  if (transportKind === "http") {
    await startMcpHttpTransport({ server, logger });
    return;
  }
  await connectServerWithStdio(server, logger);
}