import { z } from "zod";
import type { RegisterGovToolDeps } from "../types.js";
import {
  executeGetOrchestrationSessionTool
} from "../../core/application/chat/services/chat-orchestration-session-tools.js";
import type { OrchestrationSession } from "../../core/types/index.js";
import type { WorkflowEventProjectionSummary } from "../../infrastructure/workflow/temporal-workflow-event-projection.js";

export interface DefineGetOrchestrationSessionDeps extends RegisterGovToolDeps {
  getSessionOrRestore: (sessionId: string) => Promise<OrchestrationSession | undefined>;
  getWorkflowEventProjection: (sessionId: string) => Promise<WorkflowEventProjectionSummary | undefined>;
}

export function defineGetOrchestrationSessionTool(deps: DefineGetOrchestrationSessionDeps): void {
  const { govTool, getSessionOrRestore, getWorkflowEventProjection } = deps;

  govTool(
    "get_orchestration_session",
    {
      title: "オーケストレーションセッション取得",
      description: "オーケストレーションセッションの状態を取得します。",
      inputSchema: z.object({
        sessionId: z.string()
      })
    },
    async ({ sessionId }: { sessionId: string }) => {
      const result = await executeGetOrchestrationSessionTool({
        sessionId,
        getSessionOrRestore,
        getWorkflowEventProjection
      });
      if (result.notFoundText) {
        return {
          content: [{ type: "text", text: result.notFoundText }]
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result.response ?? {}, null, 2)
          }
        ]
      };
    }
  );
}
