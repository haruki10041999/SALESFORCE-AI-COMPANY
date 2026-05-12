import { z } from "zod";
import {
  executeEvaluateHandlerSchedule
} from "../../core/application/governance/services/resource-governance-read-operations.js";
import type { RegisterGovToolDeps } from "../types.js";
import type { HandlerScheduleRule } from "../../core/governance/handler-schedule.js";

export interface DefineEvaluateHandlerScheduleDeps extends RegisterGovToolDeps {
  // No additional deps beyond govTool
}

export function defineEvaluateHandlerScheduleTool(deps: DefineEvaluateHandlerScheduleDeps): void {
  const { govTool } = deps;

  govTool(
    "evaluate_handler_schedule",
    {
      title: "ハンドラ時間帯スケジューラ",
      description: "ツール名とスケジュールルールから、現在 (または指定時刻) でハンドラがアクティブかを評価します。",
      inputSchema: z.object({
        toolNames: z.array(z.string()).min(1),
        rules: z.array(z.object({
          toolName: z.string(),
          days: z.array(z.number().int().min(0).max(6)).optional(),
          startHour: z.number().min(0).max(24),
          endHour: z.number().min(0).max(24),
          timezoneOffsetMinutes: z.number().int().min(-14 * 60).max(14 * 60).optional(),
          allow: z.boolean().optional(),
          note: z.string().optional()
        })),
        at: z.string().optional()
      })
    },
    async ({ toolNames, rules, at }: {
      toolNames: string[];
      rules: HandlerScheduleRule[];
      at?: string;
    }) => {
      const payload = executeEvaluateHandlerSchedule({ toolNames, rules, at });
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }]
      };
    }
  );
}
