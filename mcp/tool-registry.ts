import { registerAllTools as registerAllToolsModule } from "./core/registration/register-all-tools.js";
import { buildRegisterAllToolsDepsFromOptions } from "./core/registration/register-all-tools-deps-builder.js";
import type { BuildRegisterAllToolsDepsOptions } from "./core/registration/register-all-tools-deps-options.js";
import { createCompositionRoot } from "./composition-root.js";
import type { HandlerContext } from "./core/application/handler-context.js";
import type { AgentChatService } from "./core/application/chat/services/agent-chat-service.js";
import type { LlmCompletionPort } from "./core/ports/llm-completion-port.js";
import type { MemoryService } from "./core/ports/memory-service.js";
import type { WorkflowEngine } from "./core/ports/workflow-engine.js";
import type { GovernanceGate } from "./core/ports/governance-gate.js";
import type { CostLedgerPort } from "./core/ports/cost-ledger-port.js";
import type { ObservabilityPort } from "./core/ports/observability-port.js";
import type { OutputsPort } from "./core/ports/outputs-port.js";
import type { RequestContext } from "./core/runtime/request-context.js";
import { createWorkflowEngine } from "./infrastructure/workflow/workflow-engine-factory.js";
import { createCompletionPortFromAgentChat } from "./infrastructure/llm/completion-port-from-agent-chat.js";
import { PostgresLlmCacheStore } from "./infrastructure/llm/llm-cache-postgres.js";
import { createCachedCompletionPort } from "./infrastructure/llm/llm-cache-completion-port.js";
import { getReplayDeterminismMode, getReplayRequireLlmCacheHit } from "./core/config/runtime-config.js";

export type RegisterServerToolsOptions = BuildRegisterAllToolsDepsOptions;

export interface RegisterServerToolsResult {
  handlerContext: HandlerContext;
}

/**
 * Build port implementations from server tool options
 */
function buildPortImplementations(options: RegisterServerToolsOptions): {
  agentChatService: AgentChatService;
  llmCompletionPort: LlmCompletionPort;
  memoryService: MemoryService;
  workflowEngine: WorkflowEngine;
  governanceGate: GovernanceGate;
  costLedger: CostLedgerPort;
  observability: ObservabilityPort;
  outputs: OutputsPort;
} {
  function isRequestContext(value: unknown): value is RequestContext {
    return typeof value === "object"
      && value !== null
      && typeof (value as { actorId?: unknown }).actorId === "string"
      && typeof (value as { tenantId?: unknown }).tenantId === "string"
      && typeof (value as { traceId?: unknown }).traceId === "string";
  }

  const agentChatService: AgentChatService = {
    chat: options.runChatTool
  };

  const baseCompletionPort: LlmCompletionPort = createCompletionPortFromAgentChat(agentChatService);
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const replayMode = getReplayDeterminismMode("observe", process.env);
  const requireCacheHit = getReplayRequireLlmCacheHit(false, process.env);
  const llmCompletionPort: LlmCompletionPort = databaseUrl
    ? createCachedCompletionPort(
        baseCompletionPort,
        new PostgresLlmCacheStore(databaseUrl),
        {
          replayMode,
          requireCacheHit,
          adapterName: "agent-chat-fallback",
          adapterVersion: "v1"
        }
      )
    : baseCompletionPort;

  return {
    agentChatService,
    llmCompletionPort,
    memoryService: {
      async add(ctxOrText: RequestContext | string, maybeText?: string): Promise<void> {
        const text = typeof maybeText === "string" ? maybeText : (ctxOrText as string);
        await options.addMemory(text);
      },
      async search(ctxOrQuery: RequestContext | string, maybeQuery?: string): Promise<string[]> {
        const query = typeof maybeQuery === "string" ? maybeQuery : (ctxOrQuery as string);
        return options.searchMemory(query);
      },
      async list(_ctx?: RequestContext): Promise<string[]> {
        return options.listMemory();
      },
      async clear(_ctx?: RequestContext): Promise<void> {
        await options.clearMemory();
      }
    },
    workflowEngine: createWorkflowEngine({
      orchestrationQueueStore: options.orchestrationQueueStore,
      orchestrationJobRunner: options.orchestrationJobRunner
    }),
    governanceGate: {
      isToolEnabled: async () => true,
      filterSkills: options.filterDisabledSkills
    },
    costLedger: {
      async record(
        _ctxOrInput: RequestContext | {
          toolName: string;
          costUsd: number;
          inputTokens?: number;
          outputTokens?: number;
          actorId?: string;
          tenantId?: string;
          sessionId?: string;
          traceId?: string;
          model?: string;
          status?: "success" | "error" | "blocked";
          metadata?: Record<string, unknown>;
        },
        _maybeInput?: {
          toolName: string;
          costUsd: number;
          inputTokens?: number;
          outputTokens?: number;
          actorId?: string;
          tenantId?: string;
          sessionId?: string;
          traceId?: string;
          model?: string;
          status?: "success" | "error" | "blocked";
          metadata?: Record<string, unknown>;
        }
      ): Promise<void> {
        return;
      }
    },
    observability: {
      async recordEvent(
        ctxOrName: RequestContext | string,
        nameOrPayload: string | Record<string, unknown>,
        maybePayload?: Record<string, unknown>
      ): Promise<void> {
        if (isRequestContext(ctxOrName)) {
          await options.emitSystemEvent(nameOrPayload as string, maybePayload ?? {});
          return;
        }
        await options.emitSystemEvent(ctxOrName, nameOrPayload as Record<string, unknown>);
      }
    },
    outputs: {
      async writeArtifact(
        ctxOrPath: RequestContext | string,
        pathOrContent: string,
        contentOrOptions?: string | { contentType?: string },
        _maybeOptions?: { contentType?: string }
      ): Promise<void> {
        void ctxOrPath;
        void pathOrContent;
        void contentOrOptions;
        return;
      },
      async appendEvent(
        ctxOrPath: RequestContext | string,
        pathOrEvent: string | unknown,
        _maybeEvent?: unknown
      ): Promise<void> {
        void ctxOrPath;
        void pathOrEvent;
        return;
      },
      async readArtifact(
        ctxOrPath: RequestContext | string,
        maybePath?: string
      ): Promise<string | null> {
        void ctxOrPath;
        void maybePath;
        return null;
      }
    }
  };
}

export function registerServerTools(options: RegisterServerToolsOptions): RegisterServerToolsResult {
  // Build port implementations
  const ports = buildPortImplementations(options);

  // Initialize composition root with awilix container
  const { handlerContext } = createCompositionRoot({
    agentChatService: ports.agentChatService,
    llmCompletionPort: ports.llmCompletionPort,
    memoryService: ports.memoryService,
    workflowEngine: ports.workflowEngine,
    governanceGate: ports.governanceGate,
    costLedger: ports.costLedger,
    observability: ports.observability,
    outputs: ports.outputs
  });

  registerAllToolsModule(buildRegisterAllToolsDepsFromOptions(options));

  return { handlerContext };
}