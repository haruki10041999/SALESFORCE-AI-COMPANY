import { z } from "zod";
import type { RegisterGovToolDeps } from "../types.js";
import {
  type CleanupSchedule,
  type CleanupScheduleAction,
  type CleanupScheduleStatus
} from "../../core/resource/cleanup-scheduler.js";
import { executeGovernanceAutoCleanupSchedule } from "../../core/application/resource/services/resource-cleanup-schedule.js";

export interface DefineGovernanceAutoCleanupScheduleDeps extends RegisterGovToolDeps {
  root: string;
  cleanupScheduleSync?: {
    upsert: (schedule: CleanupSchedule) => Promise<void>;
    remove: (scheduleId: string) => Promise<void>;
  };
}

export function defineGovernanceAutoCleanupScheduleTool(deps: DefineGovernanceAutoCleanupScheduleDeps): void {
  const { govTool, root, cleanupScheduleSync } = deps;

  govTool(
    "governance_auto_cleanup_schedule",
    {
      title: "自動クリーンアップスケジューラ",
      description:
        "cron 表現で suggest_cleanup_resources の自動実行を管理します。dry-run/apply モード、pause/resume、due チェックに対応。",
      inputSchema: z.object({
        operation: z.enum([
          "list",
          "create",
          "update",
          "delete",
          "pause",
          "resume",
          "due",
          "validate-cron"
        ]),
        id: z.string().optional(),
        name: z.string().optional(),
        cron: z.string().optional(),
        action: z.enum(["dry-run", "apply"]).optional(),
        daysUnused: z.number().int().min(1).max(365).optional(),
        limit: z.number().int().min(1).max(200).optional(),
        requireApproval: z.boolean().optional(),
        status: z.enum(["active", "paused"]).optional(),
        when: z.string().optional()
      })
    },
    async ({
      operation,
      id,
      name,
      cron,
      action,
      daysUnused,
      limit,
      requireApproval,
      status,
      when
    }: {
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
    }) => {
      const payload = await executeGovernanceAutoCleanupSchedule({
        operation,
        id,
        name,
        cron,
        action,
        daysUnused,
        limit,
        requireApproval,
        status,
        when,
        root,
        cleanupScheduleSync
      });

      return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
    }
  );
}
