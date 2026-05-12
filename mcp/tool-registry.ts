import { registerAllTools as registerAllToolsModule } from "./core/registration/register-all-tools.js";
import { buildRegisterAllToolsDepsFromOptions } from "./core/registration/register-all-tools-deps-builder.js";
import type { BuildRegisterAllToolsDepsOptions } from "./core/registration/register-all-tools-deps-options.js";
import { createCompositionRoot, getCompositionContainer } from "./composition-root.js";
import type { HandlerContext } from "./core/application/handler-context.js";
import type { LlmGateway } from "./core/ports/llm-gateway.js";
import type { MemoryService } from "./core/ports/memory-service.js";
import type { WorkflowEngine } from "./core/ports/workflow-engine.js";
import type { GovernanceGate } from "./core/ports/governance-gate.js";
import type { CostLedgerPort } from "./core/ports/cost-ledger-port.js";
import type { ObservabilityPort } from "./core/ports/observability-port.js";
import type { OutputsPort } from "./core/ports/outputs-port.js";

export type RegisterServerToolsOptions = BuildRegisterAllToolsDepsOptions;

export interface RegisterServerToolsResult {
  handlerContext: HandlerContext;
}

/**
 * Build port implementations from server tool options
 */
function buildPortImplementations(options: RegisterServerToolsOptions): {
  llmGateway: LlmGateway;
  memoryService: MemoryService;
  workflowEngine: WorkflowEngine;
  governanceGate: GovernanceGate;
  costLedger: CostLedgerPort;
  observability: ObservabilityPort;
  outputs: OutputsPort;
} {
  return {
    llmGateway: {
      chat: options.runChatTool
    },
    memoryService: {
      add: options.addMemory,
      search: options.searchMemory,
      list: options.listMemory,
      clear: options.clearMemory
    },
    workflowEngine: {
      async enqueue(): Promise<void> {
        return;
      }
    },
    governanceGate: {
      isToolEnabled: async () => true,
      filterSkills: options.filterDisabledSkills
    },
    costLedger: {
      async record(): Promise<void> {
        return;
      }
    },
    observability: {
      recordEvent: options.emitSystemEvent
    },
    outputs: {
      async writeArtifact(): Promise<void> {
        return;
      },
      async appendEvent(): Promise<void> {
        return;
      },
      async readArtifact(): Promise<string | null> {
        return null;
      }
    }
  };
}

export function registerServerTools(options: RegisterServerToolsOptions): RegisterServerToolsResult {
  // Build port implementations
  const ports = buildPortImplementations(options);

  // Initialize composition root with awilix container
  const { handlerContext, container } = createCompositionRoot({
    llmGateway: ports.llmGateway,
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