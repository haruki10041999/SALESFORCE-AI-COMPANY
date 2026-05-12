import { z } from "zod";
import type { RegisterGovToolDeps } from "../types.js";
import {
  executeRestoreOrchestrationSessionTool
} from "../../core/application/chat/services/chat-orchestration-session-tools.js";
import type { SessionStore } from "../../core/persistence/session-store.js";

export interface DefineRestoreOrchestrationSessionDeps extends RegisterGovToolDeps {
  sessionStore: SessionStore;
  liveSessionCache: Map<string, any>;
}

export function defineRestoreOrchestrationSessionTool(deps: DefineRestoreOrchestrationSessionDeps): void {
  const { govTool, sessionStore, liveSessionCache } = deps;

  govTool(
    "restore_orchestration_session",
    {
      title: "オーケストレーションセッション復元",
      description: "保存済みオーケストレーションセッションを復元します。",
      inputSchema: z.object({
        sessionId: z.string()
      })
    },
    async ({ sessionId }: { sessionId: string }) => {
      const result = await executeRestoreOrchestrationSessionTool({
        sessionId,
        getById: (targetSessionId) => sessionStore.getById(targetSessionId),
        setLiveSession: (targetSessionId, session) => {
          liveSessionCache.set(targetSessionId, session);
        }
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
