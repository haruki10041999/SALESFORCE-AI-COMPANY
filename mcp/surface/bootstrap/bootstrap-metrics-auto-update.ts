interface MetricsAutoUpdateBootstrapLogger {
  info(message: string): void;
  warn(message: string): void;
}

export interface StartMetricsAutoUpdateBootstrapOptions {
  enabled: boolean;
  intervalMinutes: number;
  logger: MetricsAutoUpdateBootstrapLogger;
  runLeaderGatedUpdate: () => Promise<void>;
  summarizeError: (error: unknown) => string;
}

export interface MetricsAutoUpdateBootstrapHandle {
  stop(): void;
}

export async function startMetricsAutoUpdateBootstrap(
  options: StartMetricsAutoUpdateBootstrapOptions
): Promise<MetricsAutoUpdateBootstrapHandle | null> {
  if (!options.enabled) {
    return null;
  }

  const safeIntervalMinutes = Math.max(1, options.intervalMinutes);
  const intervalMs = safeIntervalMinutes * 60 * 1000;

  try {
    await options.runLeaderGatedUpdate();
  } catch (error) {
    options.logger.warn(
      `metrics auto-update startup run failed: ${options.summarizeError(error)}`
    );
  }

  const timer = setInterval(() => {
    void options.runLeaderGatedUpdate().catch((error) => {
      options.logger.warn(
        `metrics auto-update interval run failed: ${options.summarizeError(error)}`
      );
    });
  }, intervalMs);

  options.logger.info(
    `metrics auto-update scheduler started (interval=${safeIntervalMinutes}m, leader-gated)`
  );

  return {
    stop(): void {
      clearInterval(timer);
    }
  };
}
