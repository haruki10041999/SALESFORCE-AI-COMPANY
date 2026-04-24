import { connectServerWithStdio } from "./bootstrap.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { Logger } from "./core/logging/logger.js";

interface ConnectableServer {
  connect: (transport: Transport) => Promise<void>;
}

export async function startMcpTransport(server: ConnectableServer, logger: Logger): Promise<void> {
  await connectServerWithStdio(server, logger);
}