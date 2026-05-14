import type { CostLedgerPort } from "../ports/cost-ledger-port.js";
import type { GovernanceGate } from "../ports/governance-gate.js";
import type { AgentChatService } from "./chat/services/agent-chat-service.js";
import type { LlmCompletionPort } from "../ports/llm-completion-port.js";
import type { MemoryService } from "../ports/memory-service.js";
import type { ObservabilityPort } from "../ports/observability-port.js";
import type { OutputsPort } from "../ports/outputs-port.js";
import type { WorkflowEngine } from "../ports/workflow-engine.js";

export interface HandlerContext {
  agentChatService: AgentChatService;
  llmCompletionPort: LlmCompletionPort;
  memoryService: MemoryService;
  workflowEngine: WorkflowEngine;
  governanceGate: GovernanceGate;
  costLedger: CostLedgerPort;
  observability: ObservabilityPort;
  outputs: OutputsPort;
}
