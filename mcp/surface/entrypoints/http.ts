import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { Logger } from "../../core/logging/logger.js";
import { startMcpHttpTransport } from "../../transport-http.js";

interface ConnectableServer {
  connect: (transport: Transport) => Promise<void>;
}

export async function startHttpSurfaceEntrypoint(
  server: ConnectableServer,
  logger: Logger
): Promise<void> {
  await startMcpHttpTransport({ server, logger });
}
