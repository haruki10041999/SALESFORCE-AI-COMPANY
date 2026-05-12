import type { GovernanceState } from "../core/governance/governance-state.js";
import type { SystemEventRecord, SystemEventName } from "../core/event/system-event-manager.js";
import type { RegisterGovToolDeps } from "./types.js";
import { defineGetToolProgressTool } from "./logging/get-tool-progress.js";
import { defineGetSystemEventsTool } from "./logging/get-system-events.js";
import { defineParseAndRecordChatTool } from "./logging/parse-and-record-chat.js";
import { defineEventAutomationConfigTools } from "./logging/event-automation-config.js";
import { defineReasoningTools } from "./logging/reasoning-tools.js";
import { defineAgentLogTools } from "./logging/agent-log-tools.js";

interface AgentMessage {
  agent: string;
  message: string;
  timestamp: string;
  topic?: string;
}

interface RegisterLoggingToolsDeps extends RegisterGovToolDeps {
  agentLog: AgentMessage[];
  loadSystemEvents: (limit?: number, event?: SystemEventName) => Promise<SystemEventRecord[]>;
  loadGovernanceState: () => Promise<GovernanceState>;
  saveGovernanceState: (state: GovernanceState) => Promise<void>;
  buildDefaultGovernanceState: () => GovernanceState;
  normalizeProtectedTools: (names: string[]) => string[];
  saveChatHistory?: (topic: string) => Promise<string>;
  emitSystemEvent?: (event: string, payload: Record<string, unknown>) => Promise<void>;
}

export function registerLoggingTools(deps: RegisterLoggingToolsDeps): void {
  const {
    govTool,
    agentLog,
    loadSystemEvents,
    loadGovernanceState,
    saveGovernanceState,
    buildDefaultGovernanceState,
    normalizeProtectedTools,
    saveChatHistory,
    emitSystemEvent
  } = deps;

  defineReasoningTools({ govTool });
  defineAgentLogTools({ govTool, agentLog });

  defineParseAndRecordChatTool({
    govTool,
    agentLog,
    saveChatHistory,
    emitSystemEvent
  });

  defineGetSystemEventsTool({ govTool, loadSystemEvents });

  defineEventAutomationConfigTools({
    govTool,
    loadGovernanceState,
    saveGovernanceState,
    buildDefaultGovernanceState,
    normalizeProtectedTools
  });

  defineGetToolProgressTool({ govTool });
}

