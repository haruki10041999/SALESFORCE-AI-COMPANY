import { asValue, createContainer, AwilixContainer, InjectionMode } from "awilix";
import type { HandlerContext } from "./core/application/handler-context.js";
import type { AgentChatService } from "./core/application/chat/services/agent-chat-service.js";
import type { CostLedgerPort } from "./core/ports/cost-ledger-port.js";
import type { GovernanceGate } from "./core/ports/governance-gate.js";
import type { LlmCompletionPort } from "./core/ports/llm-completion-port.js";
import type { MemoryService } from "./core/ports/memory-service.js";
import type { ObservabilityPort } from "./core/ports/observability-port.js";
import type { OutputsPort } from "./core/ports/outputs-port.js";
import type { WorkflowEngine } from "./core/ports/workflow-engine.js";

export interface CompositionRootOptions {
  agentChatService: AgentChatService;
  llmCompletionPort: LlmCompletionPort;
  memoryService: MemoryService;
  workflowEngine: WorkflowEngine;
  governanceGate: GovernanceGate;
  costLedger: CostLedgerPort;
  observability: ObservabilityPort;
  outputs: OutputsPort;
}

let container: AwilixContainer | null = null;

/**
 * Create and configure the awilix container with all port implementations
 */
export function createCompositionRoot(options: CompositionRootOptions): { handlerContext: HandlerContext; container: AwilixContainer } {
  const newContainer = createContainer({
    injectionMode: InjectionMode.PROXY,
    strict: true
  });

  // Register ports as singleton values without fallback casts.
  newContainer.register({
    agentChatService: asValue(options.agentChatService),
    llmCompletionPort: asValue(options.llmCompletionPort),
    memoryService: asValue(options.memoryService),
    workflowEngine: asValue(options.workflowEngine),
    governanceGate: asValue(options.governanceGate),
    costLedger: asValue(options.costLedger),
    observability: asValue(options.observability),
    outputs: asValue(options.outputs)
  });

  const handlerContext: HandlerContext = {
    agentChatService: options.agentChatService,
    llmCompletionPort: options.llmCompletionPort,
    memoryService: options.memoryService,
    workflowEngine: options.workflowEngine,
    governanceGate: options.governanceGate,
    costLedger: options.costLedger,
    observability: options.observability,
    outputs: options.outputs
  };

  container = newContainer;
  return { handlerContext, container: newContainer };
}

/**
 * Get the current container instance (after initialization)
 */
export function getCompositionContainer(): AwilixContainer {
  if (!container) {
    throw new Error("Composition root not initialized. Call createCompositionRoot first.");
  }
  return container;
}
