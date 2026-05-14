import { VectorLifecycleScheduler } from "../../core/application/memory/lifecycle-scheduler.js";

interface VectorLifecycleLogger {
  info(message: string): void;
  warn(message: string): void;
}

export interface StartVectorLifecycleBootstrapOptions {
  enabled: boolean;
  databaseUrl?: string;
  cronPattern?: string;
  runOnStartup?: boolean;
  startupLimit?: number;
  hotToWarmDays?: number;
  warmToColdDays?: number;
  logger: VectorLifecycleLogger;
}

export interface VectorLifecycleBootstrapHandle {
  stop(): Promise<void>;
}

export async function startVectorLifecycleBootstrap(
  options: StartVectorLifecycleBootstrapOptions
): Promise<VectorLifecycleBootstrapHandle | null> {
  if (!options.enabled || !options.databaseUrl?.trim()) {
    return null;
  }

  const scheduler = new VectorLifecycleScheduler({
    databaseUrl: options.databaseUrl,
    cronPattern: options.cronPattern,
    policy: {
      hotToWarmDays: options.hotToWarmDays,
      warmToColdDays: options.warmToColdDays
    },
    logger: options.logger
  });

  if (options.runOnStartup) {
    const startup = await scheduler.runOnce(Math.max(1, options.startupLimit ?? 2000));
    options.logger.info(
      `[vector-lifecycle] startup scanned=${startup.scanned} changed=${startup.changed} unchanged=${startup.unchanged}`
    );
  }

  scheduler.start();
  options.logger.info("[vector-lifecycle] scheduler started");

  return {
    async stop(): Promise<void> {
      await scheduler.stop();
    }
  };
}
