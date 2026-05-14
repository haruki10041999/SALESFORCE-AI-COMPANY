import {
  getDefaultSchedulesFilePath,
  loadCleanupSchedules
} from "../../core/application/resource/cleanup-scheduler.js";

interface CleanupSyncLogger {
  info(message: string): void;
  warn(message: string): void;
}

interface LeaderElectionLike {
  runIfLeader(options: {
    lockKey: string;
    onLeader: () => Promise<void>;
    onFollower: () => Promise<void>;
  }): Promise<void>;
  describeInstance(): string;
}

interface SchedulableProposalQueue {
  scheduleRecurringJob?: (options: {
    queue: string;
    cron: string;
    key: string;
    data: Record<string, unknown>;
  }) => Promise<void>;
  unscheduleRecurringJob?: (options: {
    queue: string;
    key: string;
  }) => Promise<void>;
}

export interface GovernanceCleanupSyncOptions {
  proposalQueueBackend: string;
  proposalQueue: SchedulableProposalQueue;
  leaderElection: LeaderElectionLike;
  rootDir: string;
  logger: CleanupSyncLogger;
  summarizeError: (error: unknown) => string;
}

export async function runGovernanceCleanupStartupSync(
  options: GovernanceCleanupSyncOptions
): Promise<void> {
  if (
    options.proposalQueueBackend !== "pg-boss" ||
    typeof options.proposalQueue.scheduleRecurringJob !== "function" ||
    typeof options.proposalQueue.unscheduleRecurringJob !== "function"
  ) {
    return;
  }

  const scheduleRecurringJob = options.proposalQueue.scheduleRecurringJob.bind(options.proposalQueue);
  const unscheduleRecurringJob = options.proposalQueue.unscheduleRecurringJob.bind(options.proposalQueue);

  try {
    await options.leaderElection.runIfLeader({
      lockKey: "governance-auto-cleanup:start-sync",
      onLeader: async () => {
        const cleanupSchedules = await loadCleanupSchedules(getDefaultSchedulesFilePath(options.rootDir));
        for (const schedule of cleanupSchedules.schedules) {
          if (schedule.status !== "active") {
            await unscheduleRecurringJob({
              queue: "governance-auto-cleanup",
              key: schedule.id
            });
            continue;
          }

          await scheduleRecurringJob({
            queue: "governance-auto-cleanup",
            cron: schedule.cron,
            key: schedule.id,
            data: {
              scheduleId: schedule.id,
              action: schedule.action,
              daysUnused: schedule.daysUnused,
              limit: schedule.limit,
              requireApproval: schedule.requireApproval
            }
          });
        }
        options.logger.info("cleanup schedule startup sync completed as leader");
      },
      onFollower: async () => {
        options.logger.info(
          `cleanup schedule startup sync skipped (not leader, instance=${options.leaderElection.describeInstance()})`
        );
      }
    });
  } catch (error) {
    options.logger.warn(`cleanup schedule startup sync failed: ${options.summarizeError(error)}`);
  }
}
