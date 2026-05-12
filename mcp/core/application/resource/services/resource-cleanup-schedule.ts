import {
  loadCleanupSchedules,
  saveCleanupSchedules,
  createCleanupSchedule,
  updateCleanupSchedule,
  deleteCleanupSchedule,
  setCleanupScheduleStatus,
  getDueSchedules,
  parseCronExpression,
  getDefaultSchedulesFilePath,
  type CleanupSchedule,
  type CleanupScheduleAction,
  type CleanupScheduleStatus
} from "../../../resource/cleanup-scheduler.js";

export async function executeGovernanceAutoCleanupSchedule(args: {
  operation:
    | "list"
    | "create"
    | "update"
    | "delete"
    | "pause"
    | "resume"
    | "due"
    | "validate-cron";
  id?: string;
  name?: string;
  cron?: string;
  action?: CleanupScheduleAction;
  daysUnused?: number;
  limit?: number;
  requireApproval?: boolean;
  status?: CleanupScheduleStatus;
  when?: string;
  root: string;
  cleanupScheduleSync?: {
    upsert: (schedule: CleanupSchedule) => Promise<void>;
    remove: (scheduleId: string) => Promise<void>;
  };
}): Promise<Record<string, unknown>> {
  const filePath = getDefaultSchedulesFilePath(args.root);

  if (args.operation === "validate-cron") {
    if (!args.cron) {
      return { valid: false, error: "cron is required" };
    }
    const parsed = parseCronExpression(args.cron);
    return { valid: parsed !== null, cron: args.cron };
  }

  const current = await loadCleanupSchedules(filePath);

  if (args.operation === "list") {
    return { filePath, schedules: current.schedules };
  }

  if (args.operation === "due") {
    const evalDate = args.when ? new Date(args.when) : new Date();
    const due = getDueSchedules(current, evalDate);
    return { evaluatedAt: evalDate.toISOString(), due };
  }

  if (args.operation === "create") {
    if (!args.name || !args.cron) {
      return { error: "name and cron are required" };
    }
    try {
      const result = createCleanupSchedule(current, {
        name: args.name,
        cron: args.cron,
        action: args.action,
        daysUnused: args.daysUnused,
        limit: args.limit,
        requireApproval: args.requireApproval,
        status: args.status
      });
      await saveCleanupSchedules(filePath, result.file);
      if (args.cleanupScheduleSync) {
        await args.cleanupScheduleSync.upsert(result.schedule);
      }
      return { created: result.schedule };
    } catch (err) {
      return { error: (err as Error).message };
    }
  }

  if (args.operation === "update") {
    if (!args.id) {
      return { error: "id is required" };
    }
    try {
      const result = updateCleanupSchedule(current, args.id, {
        name: args.name,
        cron: args.cron,
        action: args.action,
        daysUnused: args.daysUnused,
        limit: args.limit,
        requireApproval: args.requireApproval,
        status: args.status
      });
      await saveCleanupSchedules(filePath, result.file);
      if (args.cleanupScheduleSync) {
        await args.cleanupScheduleSync.upsert(result.schedule);
      }
      return { updated: result.schedule };
    } catch (err) {
      return { error: (err as Error).message };
    }
  }

  if (args.operation === "delete") {
    if (!args.id) {
      return { error: "id is required" };
    }
    const result = deleteCleanupSchedule(current, args.id);
    await saveCleanupSchedules(filePath, result.file);
    if (args.cleanupScheduleSync && result.deleted) {
      await args.cleanupScheduleSync.remove(args.id);
    }
    return { deleted: result.deleted, id: args.id };
  }

  if (args.operation === "pause" || args.operation === "resume") {
    if (!args.id) {
      return { error: "id is required" };
    }
    try {
      const newStatus: CleanupScheduleStatus = args.operation === "pause" ? "paused" : "active";
      const result = setCleanupScheduleStatus(current, args.id, newStatus);
      await saveCleanupSchedules(filePath, result.file);
      if (args.cleanupScheduleSync) {
        if (newStatus === "active") {
          await args.cleanupScheduleSync.upsert(result.schedule);
        } else {
          await args.cleanupScheduleSync.remove(result.schedule.id);
        }
      }
      return { updated: result.schedule };
    } catch (err) {
      return { error: (err as Error).message };
    }
  }

  return { error: "unknown operation" };
}