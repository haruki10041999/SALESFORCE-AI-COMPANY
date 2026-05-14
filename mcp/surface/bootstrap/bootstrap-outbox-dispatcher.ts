import { PgBossOutboxPort } from "../../infrastructure/outbox/pgboss-outbox.js";

interface OutboxDispatcherLogger {
  info(message: string): void;
  warn(message: string): void;
  debug?(message: string): void;
}

export interface StartOutboxDispatcherBootstrapOptions {
  enabled: boolean;
  databaseUrl?: string;
  queuePrefix?: string;
  dispatchLimit: number;
  intervalSeconds: number;
  logger: OutboxDispatcherLogger;
  leaderElection?: {
    runIfLeader(args: {
      lockKey: string;
      onLeader: () => Promise<void>;
      onFollower?: () => Promise<void>;
    }): Promise<void>;
    describeInstance?: () => string;
  };
}

export interface OutboxDispatcherHandle {
  stop(): Promise<void>;
}

export async function startOutboxDispatcherBootstrap(
  options: StartOutboxDispatcherBootstrapOptions
): Promise<OutboxDispatcherHandle | null> {
  if (!options.enabled || !options.databaseUrl?.trim()) {
    return null;
  }

  const outbox = await PgBossOutboxPort.open({
    databaseUrl: options.databaseUrl,
    queuePrefix: options.queuePrefix
  });

  const dispatchLimit = Math.max(1, options.dispatchLimit);
  const intervalMs = Math.max(5, options.intervalSeconds) * 1000;
  let stopped = false;
  let inFlight = false;

  const runDispatchOnce = async (): Promise<void> => {
    if (stopped || inFlight) {
      return;
    }
    inFlight = true;
    try {
      if (options.leaderElection) {
        await options.leaderElection.runIfLeader({
          lockKey: "outbox-dispatch",
          onLeader: async () => {
            const result = await outbox.dispatchPending({ limit: dispatchLimit });
            if (result.scanned > 0) {
              options.logger.info(
                `[outbox-dispatch] scanned=${result.scanned} dispatched=${result.dispatched} failed=${result.failed}`
              );
            }
          },
          onFollower: async () => {
            options.logger.debug?.(
              `[outbox-dispatch] skipped (not leader, instance=${options.leaderElection?.describeInstance?.() ?? "unknown"})`
            );
          }
        });
      } else {
        const result = await outbox.dispatchPending({ limit: dispatchLimit });
        if (result.scanned > 0) {
          options.logger.info(
            `[outbox-dispatch] scanned=${result.scanned} dispatched=${result.dispatched} failed=${result.failed}`
          );
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      options.logger.warn(`[outbox-dispatch] failed: ${message}`);
    } finally {
      inFlight = false;
    }
  };

  await runDispatchOnce();
  const timer = setInterval(() => {
    void runDispatchOnce();
  }, intervalMs);

  options.logger.info(`[outbox-dispatch] started (interval=${Math.round(intervalMs / 1000)}s, limit=${dispatchLimit})`);

  return {
    async stop(): Promise<void> {
      if (stopped) {
        return;
      }
      stopped = true;
      clearInterval(timer);
      await outbox.close();
    }
  };
}
