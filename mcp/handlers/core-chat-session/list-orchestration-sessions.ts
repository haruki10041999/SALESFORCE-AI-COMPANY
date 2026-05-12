import { z } from "zod";
import type { RegisterGovToolDeps } from "../types.js";
import {
  executeListOrchestrationSessionsTool
} from "../../core/application/chat/services/chat-orchestration-session-tools.js";
import type { SessionStore } from "../../core/persistence/session-store.js";

export interface DefineListOrchestrationSessionsDeps extends RegisterGovToolDeps {
  sessionStore: SessionStore;
}

export function defineListOrchestrationSessionsTool(deps: DefineListOrchestrationSessionsDeps): void {
  const { govTool, sessionStore } = deps;

  govTool(
    "list_orchestration_sessions",
    {
      title: "オーケストレーションセッション一覧",
      description: "オーケストレーションセッションの一覧を取得します。",
      inputSchema: z.object({})
    },
    async () => {
      const sessions = await executeListOrchestrationSessionsTool({
        listSessions: () => sessionStore.list()
      });

      return {
        content: [{ type: "text", text: JSON.stringify(sessions, null, 2) }]
      };
    }
  );
}
