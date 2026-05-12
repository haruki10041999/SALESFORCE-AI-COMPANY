import { executeGetHandlersDashboardTool } from "../../core/application/analytics/services/analytics-handler-admin-tools.js";
import type { HandlersDashboardState } from "../../core/types/index.js";
import type { RegisterGovToolDeps } from "../types.js";

export interface DefineGetHandlersDashboardDeps extends RegisterGovToolDeps {
  generateHandlersDashboard: (state: HandlersDashboardState) => HandlersDashboardState;
  handlersState: HandlersDashboardState;
}

export function defineGetHandlersDashboardTool(deps: DefineGetHandlersDashboardDeps): void {
  const { govTool, generateHandlersDashboard, handlersState } = deps;

  govTool(
    "get_handlers_dashboard",
    {
      title: "ハンドラーダッシュボード取得",
      description: "ハンドラーのダッシュボード情報を取得します。",
      inputSchema: {}
    },
    async () => {
      const content = await executeGetHandlersDashboardTool({
        generateHandlersDashboard,
        handlersState
      });
      return { content };
    }
  );
}
