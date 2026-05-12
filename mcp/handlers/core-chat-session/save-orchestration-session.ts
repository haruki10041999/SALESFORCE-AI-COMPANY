import { z } from "zod";
import type { RegisterGovToolDeps } from "../types.js";
import {
  executeSaveOrchestrationSessionTool
} from "../../core/application/chat/services/chat-orchestration-session-tools.js";
import type { SessionStore } from "../../core/persistence/session-store.js";

export interface DefineSaveOrchestrationSessionDeps extends RegisterGovToolDeps {
  getSessionOrRestore: (sessionId: string) => Promise<any>;
  sessionStore: SessionStore;
}

export function defineSaveOrchestrationSessionTool(deps: DefineSaveOrchestrationSessionDeps): void {
  const { govTool, getSessionOrRestore, sessionStore } = deps;

  async function persistSession(session: any): Promise<any> {
    return sessionStore.upsert(session, -1);
  }

  govTool(
    "save_orchestration_session",
    {
      title: "オーケストレーションセッション保存",
      description: "オーケストレーションセッションを保存します。",
      inputSchema: z.object({
        sessionId: z.string()
      })
    },
    async ({ sessionId }: { sessionId: string }) => {
      const result = await executeSaveOrchestrationSessionTool({
        sessionId,
        getSessionOrRestore,
        persistSession
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
