import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Logger } from "./core/logging/logger.js";
import type { HandlersState } from "./handlers/auto-init.js";

interface RuntimeInitDeps {
  logger: Logger;
  customToolsDir: string;
  handlersState: HandlersState;
  loadCustomToolsFromDir: (customToolsDir: string) => Promise<void>;
  refreshDisabledToolsCache: (reason?: string) => Promise<void>;
  startDisabledToolsCacheSync: () => void;
  resetDisabledToolsCache: () => void;
  autoInitializeHandlers: (handlersState: HandlersState) => void;
}

interface ConnectableServer {
  connect: (transport: StdioServerTransport) => Promise<void>;
}

export async function initializeServerRuntime(deps: RuntimeInitDeps): Promise<void> {
  deps.logger.info("Runtime initialization started");

  try {
    await deps.loadCustomToolsFromDir(deps.customToolsDir);
    deps.logger.info("Custom tools loaded");
  } catch (error) {
    deps.logger.warn("Failed to load custom tools. Continuing with core tools only.", error);
  }

  try {
    await deps.refreshDisabledToolsCache("startup");
    deps.startDisabledToolsCacheSync();
    deps.logger.info("Disabled tools cache initialized");
  } catch (error) {
    deps.resetDisabledToolsCache();
    deps.logger.warn("Failed to initialize disabled tools cache. Using empty cache.", error);
  }

  try {
    deps.autoInitializeHandlers(deps.handlersState);
    deps.logger.info(`Handlers auto-initialization complete (${deps.handlersState.registeredHandlers} handlers)`);
  } catch (error) {
    deps.logger.warn("Handler auto-initialization failed. Continuing without handlers.", error);
  }
}

export async function connectServerWithStdio(server: ConnectableServer, logger: Logger): Promise<void> {
  const transport = new StdioServerTransport();
  try {
    await server.connect(transport);
    logger.info("MCP transport connected");
  } catch (error) {
    logger.error("Failed to connect MCP transport", error);
    throw error;
  }
}

export function isDirectRun(importMetaUrl: string, argvPath: string | undefined): boolean {
  if (!argvPath) {
    return false;
  }
  return pathToFileURL(resolve(argvPath)).href === importMetaUrl;
}
