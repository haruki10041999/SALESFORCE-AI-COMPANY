import { z } from "zod";
import type { GovTool } from "@mcp/tool-types.js";
import type { GovernanceState } from "../core/governance/governance-state.js";
import type { SystemEventRecord, SystemEventName } from "../core/event/system-event-manager.js";

interface AgentMessage {
  agent: string;
  message: string;
  timestamp: string;
  topic?: string;
}

interface RegisterLoggingToolsDeps {
  govTool: GovTool;
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

  govTool(
    "record_agent_message",
    {
      title: "Record Agent Message",
      description: "Auto-generated description.",
      inputSchema: {
        agent: z.string(),
        message: z.string(),
        topic: z.string().optional()
      }
    },
    async ({ agent, message, topic }: { agent: string; message: string; topic?: string }) => {
      const entry: AgentMessage = {
        agent,
        message,
        timestamp: new Date().toISOString(),
        topic
      };
      agentLog.push(entry);
      return {
        content: [{ type: "text", text: "Recorded: [" + entry.timestamp + "] " + agent }]
      };
    }
  );

  govTool(
    "get_agent_log",
    {
      title: "Get Agent Log",
      description: "Auto-generated description.",
      inputSchema: {
        agent: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional()
      }
    },
    async ({ agent, limit }: { agent?: string; limit?: number }) => {
      let entries = agentLog;
      if (agent) {
        entries = entries.filter((e) => e.agent === agent);
      }
      if (limit) {
        entries = entries.slice(-limit);
      }
      const summary = {
        total: agentLog.length,
        filtered: entries.length,
        agents: [...new Set(agentLog.map((e) => e.agent))],
        entries
      };
      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }]
      };
    }
  );

  govTool(
    "parse_and_record_chat",
    {
      title: "Parse And Record Chat",
      description: "Auto-generated description.",
      inputSchema: {
        chatText: z.string(),
        topic: z.string().optional()
      }
    },
    async ({ chatText, topic }: { chatText: string; topic?: string }) => {
      const normalized = chatText.replace(/\r\n/g, "\n");
      const pattern = /\*\*([^*\n]+)\*\*:\s([\s\S]*?)(?=\n\*\*[^*\n]+\*\*:\s|$)/g;

      const parsed: AgentMessage[] = [];
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(normalized)) !== null) {
        const agent = match[1].trim();
        const message = match[2].trim();
        if (!agent || !message) {
          continue;
        }
        parsed.push({
          agent,
          message,
          timestamp: new Date().toISOString(),
          topic
        });
      }

      if (parsed.length === 0) {
        return {
          content: [{ type: "text", text: "No agent messages were parsed. Format example: **Agent Name**: message" }]
        };
      }

      agentLog.push(...parsed);
      const uniqueAgents = [...new Set(parsed.map((p) => p.agent))];
      let autoSavedHistoryId: string | null = null;

      if (topic && saveChatHistory) {
        autoSavedHistoryId = await saveChatHistory(topic);
        if (emitSystemEvent) {
          await emitSystemEvent("history_saved", {
            historyId: autoSavedHistoryId,
            topic,
            messageCount: parsed.length,
            path: "outputs/history/" + autoSavedHistoryId + ".json",
            source: "parse_and_record_chat:auto-save"
          });
        }
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                recorded: parsed.length,
                topic: topic ?? null,
                agents: uniqueAgents,
                totalLogCount: agentLog.length,
                autoSavedHistoryId
              },
              null,
              2
            )
          }
        ]
      };
    }
  );

  govTool(
    "get_system_events",
    {
      title: "Get System Events",
      description: "Auto-generated description.",
      inputSchema: {
        limit: z.number().int().min(1).max(200).optional(),
        event: z.enum([
          "session_start",
          "turn_complete",
          "tool_before_execute",
          "tool_after_execute",
          "preset_before_execute",
          "governance_threshold_exceeded",
          "low_relevance_detected",
          "history_saved",
          "error_aggregate_detected",
          "session_end"
        ]).optional()
      }
    },
    async ({ limit, event }: { limit?: number; event?: SystemEventName }) => {
      const events = await loadSystemEvents(limit ?? 50, event);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                count: events.length,
                event: event ?? null,
                events
              },
              null,
              2
            )
          }
        ]
      };
    }
  );

  govTool(
    "get_event_automation_config",
    {
      title: "Get Event Automation Config",
      description: "Auto-generated description.",
      inputSchema: {}
    },
    async () => {
      const state = await loadGovernanceState();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                ...state.config.eventAutomation,
                retryStrategy: state.config.toolExecution
              },
              null,
              2
            )
          }
        ]
      };
    }
  );

  govTool(
    "update_event_automation_config",
    {
      title: "Update Event Automation Config",
      description: "Auto-generated description.",
      inputSchema: {
        enabled: z.boolean().optional(),
        protectedTools: z.array(z.string()).optional(),
        errorAggregateDetected: z.object({
          autoDisableTool: z.boolean().optional()
        }).optional(),
        governanceThresholdExceeded: z.object({
          autoDisableRecommendedTools: z.boolean().optional(),
          maxToolsPerRun: z.number().int().min(0).max(20).optional()
        }).optional(),
        retryStrategy: z.object({
          retryEnabled: z.boolean().optional(),
          maxRetries: z.number().int().min(0).max(5).optional(),
          baseDelayMs: z.number().int().min(10).max(10000).optional(),
          maxDelayMs: z.number().int().min(10).max(30000).optional(),
          retryablePatterns: z.array(z.string()).max(30).optional(),
          retryableCodes: z.array(z.string()).max(30).optional()
        }).optional()
      }
    },
    async ({ enabled, protectedTools, errorAggregateDetected, governanceThresholdExceeded, retryStrategy }: {
      enabled?: boolean;
      protectedTools?: string[];
      errorAggregateDetected?: { autoDisableTool?: boolean };
      governanceThresholdExceeded?: { autoDisableRecommendedTools?: boolean; maxToolsPerRun?: number };
      retryStrategy?: {
        retryEnabled?: boolean;
        maxRetries?: number;
        baseDelayMs?: number;
        maxDelayMs?: number;
        retryablePatterns?: string[];
        retryableCodes?: string[];
      };
    }) => {
      const defaults = buildDefaultGovernanceState().config.eventAutomation;
      const retryDefaults = buildDefaultGovernanceState().config.toolExecution;
      const state = await loadGovernanceState();
      state.config.eventAutomation = {
        ...defaults,
        ...state.config.eventAutomation,
        enabled: enabled ?? state.config.eventAutomation?.enabled ?? defaults.enabled,
        protectedTools: normalizeProtectedTools(
          protectedTools ?? state.config.eventAutomation?.protectedTools ?? defaults.protectedTools
        ),
        rules: {
          ...defaults.rules,
          ...state.config.eventAutomation?.rules,
          errorAggregateDetected: {
            ...defaults.rules.errorAggregateDetected,
            ...state.config.eventAutomation?.rules?.errorAggregateDetected,
            ...errorAggregateDetected
          },
          governanceThresholdExceeded: {
            ...defaults.rules.governanceThresholdExceeded,
            ...state.config.eventAutomation?.rules?.governanceThresholdExceeded,
            ...governanceThresholdExceeded
          }
        }
      };
      state.config.toolExecution = {
        ...retryDefaults,
        ...state.config.toolExecution,
        ...retryStrategy,
        retryablePatterns:
          retryStrategy?.retryablePatterns ??
          state.config.toolExecution?.retryablePatterns ??
          retryDefaults.retryablePatterns,
        retryableCodes:
          retryStrategy?.retryableCodes ??
          state.config.toolExecution?.retryableCodes ??
          retryDefaults.retryableCodes
      };
      await saveGovernanceState(state);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                updated: true,
                eventAutomation: state.config.eventAutomation,
                retryStrategy: state.config.toolExecution
              },
              null,
              2
            )
          }
        ]
      };
    }
  );
}

