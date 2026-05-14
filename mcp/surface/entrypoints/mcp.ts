import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { Logger } from "../../core/logging/logger.js";
import { startMcpTransport } from "../../transport.js";

interface ConnectableServer {
  connect: (transport: Transport) => Promise<void>;
}

export async function startMcpSurfaceEntrypoint(
  server: ConnectableServer,
  logger: Logger
): Promise<void> {
  await startMcpTransport(server, logger);
}
