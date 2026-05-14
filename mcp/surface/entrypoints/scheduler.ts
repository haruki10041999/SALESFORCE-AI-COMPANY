import type { Logger } from "../../core/logging/logger.js";

export interface SchedulerEntrypointOptions {
  logger: Logger;
  onTick?: () => Promise<void>;
}

export interface SchedulerEntrypointHandle {
  stop(): void;
}

export function startSchedulerEntrypoint(
  options: SchedulerEntrypointOptions
): SchedulerEntrypointHandle {
  const intervalMs = Number.parseInt(process.env.SF_AI_SCHEDULER_TICK_MS ?? "60000", 10);
  const tickMs = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 60000;

  const timer = setInterval(async () => {
    if (!options.onTick) {
      return;
    }

    try {
      await options.onTick();
    } catch (error) {
      options.logger.warn("Scheduler entrypoint tick failed", error);
    }
  }, tickMs);

  return {
    stop(): void {
      clearInterval(timer);
    }
  };
}
