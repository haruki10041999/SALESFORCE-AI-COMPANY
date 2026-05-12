import type { CostLedgerPort } from "../ports/cost-ledger-port.js";
import type { GovernanceGate } from "../ports/governance-gate.js";
import type { LlmGateway } from "../ports/llm-gateway.js";
import type { MemoryService } from "../ports/memory-service.js";
import type { ObservabilityPort } from "../ports/observability-port.js";
import type { OutputsPort } from "../ports/outputs-port.js";
import type { WorkflowEngine } from "../ports/workflow-engine.js";

export interface HandlerContext {
  llmGateway: LlmGateway;
  memoryService: MemoryService;
  workflowEngine: WorkflowEngine;
  governanceGate: GovernanceGate;
  costLedger: CostLedgerPort;
  observability: ObservabilityPort;
  outputs: OutputsPort;
}
