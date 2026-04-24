import { isDirectRun } from "./bootstrap.js";
import type { Logger } from "./core/logging/logger.js";

interface LifecycleOptions {
  importMetaUrl: string;
  argvPath: string | undefined;
  logger: Logger;
  start: () => Promise<void>;
}

export function runWithLifecycle(options: LifecycleOptions): void {
  const directRun = isDirectRun(options.importMetaUrl, options.argvPath);
  if (!directRun) {
    return;
  }

  options.start().catch((error) => {
    options.logger.error("MCP server failed to start", error);
    process.exit(1);
  });
}