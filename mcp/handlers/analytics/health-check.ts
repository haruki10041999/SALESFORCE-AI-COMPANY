import { z } from "zod";
import { executeHealthCheckTool } from "../../core/application/analytics/services/analytics-health-check.js";
import type { SystemEventLogStatus, SystemEventRecord } from "../../core/event/system-event-manager.js";
import type { GovernanceState } from "../../core/governance/governance-state.js";
import type { HandlersDashboardState } from "../../core/types/index.js";
import type { RegisterGovToolDeps } from "../types.js";

export interface DefineHealthCheckDeps extends RegisterGovToolDeps {
  loadSystemEvents: (limit?: number, event?: string) => Promise<SystemEventRecord[]>;
  loadGovernanceState: () => Promise<GovernanceState>;
  generateHandlersDashboard: (state: HandlersDashboardState) => HandlersDashboardState;
  handlersState: HandlersDashboardState;
  getSystemEventLogStatus: () => Promise<SystemEventLogStatus>;
}

export function defineHealthCheckTool(deps: DefineHealthCheckDeps): void {
  const { govTool, loadSystemEvents, loadGovernanceState, generateHandlersDashboard, handlersState, getSystemEventLogStatus } = deps;

  govTool(
    "health_check",
    {
      title: "ヘルスチェック",
      description: "システムの健全性を確認します。",
      inputSchema: {
        systemEventLimit: z.number().int().min(1).max(500).optional()
      }
    },
    async ({ systemEventLimit }: { systemEventLimit?: number }) => {
      const result = await executeHealthCheckTool({
        systemEventLimit,
        loadSystemEvents,
        loadGovernanceState,
        generateHandlersDashboard,
        handlersState,
        getSystemEventLogStatus
      });

      return {
        content: [
          { type: "text", text: JSON.stringify(result.jsonPayload, null, 2) },
          { type: "text", text: result.markdown }
        ]
      };
    }
  );
}
