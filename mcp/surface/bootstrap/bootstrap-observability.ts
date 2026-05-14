import type { Logger } from "../../core/logging/logger.js";
import { startObservabilityRuntime } from "../../core/application/observability/runtime.js";

type ObservabilityRuntime = Awaited<ReturnType<typeof startObservabilityRuntime>>;

export interface ObservabilityBootstrapHandle {
  runtime: ObservabilityRuntime;
  markStartupReady(): void;
}

export async function startObservabilityBootstrap(
  logger: Logger
): Promise<ObservabilityBootstrapHandle> {
  const runtime = await startObservabilityRuntime(logger);
  runtime.setReady(false);

  return {
    runtime,
    markStartupReady(): void {
      runtime.setStartupComplete(true);
      runtime.setReady(true);
    }
  };
}
