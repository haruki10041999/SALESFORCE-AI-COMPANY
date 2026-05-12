import type { registerAllTools } from "./register-all-tools.js";
import type { GovTool } from "@mcp/tool-types.js";
import type { z } from "zod";
import type { GovernanceState } from "../governance/governance-state.js";
import type { SystemEventName, SystemEventRecord } from "../event/system-event-manager.js";
import type { SystemEventType } from "../event/event-dispatcher.js";
import type { ProposalQueueStore } from "../resource/proposal/proposal-queue-store.js";
import type { SessionStore } from "../persistence/session-store.js";
import type { OrchestrationQueueStore } from "../orchestration/orchestration-queue-store.js";
import type { OrchestrationJobRunner } from "../orchestration/job-runner.js";
import type { PolicySnapshotManager } from "../learning/policy-snapshot.js";
import type { AgentMessage, ChatSession, HandlersDashboardState, StoredPreset, ResourceOperation } from "../types/index.js";
import type { HandlersState } from "../../handlers/auto-init.js";

type RegisterAllToolsDeps = Parameters<typeof registerAllTools>[0];

interface ToolCoreDeps {
  govTool: GovTool;
  chatInputSchema: Record<string, unknown>;
  triggerRuleSchema: z.ZodTypeAny;
  root: string;
  agentLog: AgentMessage[];
}

interface ChatAndSessionDeps {
  runChatTool: RegisterAllToolsDeps["runChatTool"];
  generateSessionId: () => string;
  filterDisabledSkills: (skills: string[]) => Promise<{ enabled: string[]; disabled: string[] }>;
  emitSystemEvent: (event: string, payload: Record<string, unknown>) => Promise<void>;
  buildChatPrompt: RegisterAllToolsDeps["buildChatPrompt"];
  evaluatePseudoHooks: RegisterAllToolsDeps["evaluatePseudoHooks"];
  sessionStore: SessionStore;
  orchestrationQueueStore: OrchestrationQueueStore;
  orchestrationJobRunner: OrchestrationJobRunner;
  policySnapshotManager: PolicySnapshotManager;
  saveSessionHistory: RegisterAllToolsDeps["saveSessionHistory"];
  onSessionCompleted?: RegisterAllToolsDeps["onSessionCompleted"];
}

interface GovernanceAndEventDeps {
  loadSystemEvents: (limit?: number, event?: SystemEventName) => Promise<SystemEventRecord[]>;
  loadGovernanceState: () => Promise<GovernanceState>;
  saveGovernanceState: (state: GovernanceState) => Promise<void>;
  buildDefaultGovernanceState: () => GovernanceState;
  normalizeProtectedTools: (names: string[]) => string[];
  getSystemEventLogStatus: RegisterAllToolsDeps["getSystemEventLogStatus"];
  generateHandlersDashboard: (state: HandlersDashboardState) => HandlersDashboardState;
  handlersState: HandlersState;
  exportStatisticsAsCsv: RegisterAllToolsDeps["exportStatisticsAsCsv"];
  exportStatisticsAsJson: RegisterAllToolsDeps["exportStatisticsAsJson"];
  loadRecentOperations: () => Promise<ResourceOperation[]>;
  checkDailyLimitExceeded: (ops: ResourceOperation[], action: "create" | "delete", limit: number) => boolean;
  appendOperationLog: (operation: ResourceOperation) => Promise<void>;
  emitEvent: (event: { type: SystemEventType; timestamp: string; payload: Record<string, unknown> }) => Promise<void>;
  resourceScore: (usage: number, bugSignals: number) => number;
  proposalQueue: ProposalQueueStore;
}

interface PresetAndPromptDeps {
  saveChatHistory: (topic: string) => Promise<string>;
  loadChatHistories: () => Promise<ChatSession[]>;
  restoreChatHistory: (id: string) => Promise<ChatSession | null>;
  listMdFiles: (dir: string) => { name: string; summary: string }[];
  getMdFile: (dir: string, name: string) => string;
  listPresetsData: () => Promise<StoredPreset[]>;
  scoreByQuery: (query: string, ...targets: string[]) => number;
  lowRelevanceScoreThreshold: number;
  registeredToolMetadata: Map<string, { title?: string; description?: string; tags?: string[] }>;
  createPreset: RegisterAllToolsDeps["createPreset"];
  getPreset: (name: string) => Promise<StoredPreset | null>;
  isPresetDisabled: (name: string) => Promise<boolean>;
  buildPrompt: (
    agent: { name: string; content: string },
    task: string,
    options?: { strategy?: "auto" | "plan" | "reflect" | "tree-of-thought" }
  ) => string;
  evaluatePromptMetrics: RegisterAllToolsDeps["evaluatePromptMetrics"];
}

interface MemoryAndIoDeps {
  ensureDir: (path: string) => Promise<void>;
  addMemory: (text: string) => Promise<void>;
  searchMemory: (query: string) => Promise<string[]>;
  listMemory: () => Promise<string[]>;
  clearMemory: () => Promise<void>;
  recordFailureMemory: (input: {
    pattern: string;
    reason: string;
    preventiveAction: string;
    tags?: string[];
  }) => Promise<{
    pattern: string;
    reason: string;
    preventiveAction: string;
    tags: string[];
    recordedAt: string;
  }>;
  searchFailureMemory: (query: string, limit?: number) => Promise<Array<{
    pattern: string;
    reason: string;
    preventiveAction: string;
    tags: string[];
    recordedAt: string;
  }>>;
  listFailureMemory: (limit?: number) => Promise<Array<{
    pattern: string;
    reason: string;
    preventiveAction: string;
    tags: string[];
    recordedAt: string;
  }>>;
  presetsDir: string;
  toolProposalsDir: string;
  customToolsDir: string;
  governanceFile: string;
}

interface SearchAndCatalogDeps {
  findMdFilesRecursive: (dir: string) => string[];
  toPosixPath: (pathValue: string) => string;
  addRecord: (record: { id: string; text: string; tags: string[] }) => void;
  searchByKeyword: (query: string) => Array<{ id: string; text: string; tags?: string[] }>;
  searchByKeywordAsync?: (
    query: string,
    options?: { limit?: number; minScore?: number }
  ) => Promise<Array<{ id: string; text: string; tags?: string[]; score?: number }>>;
  listSkillsCatalog: () => Promise<string[]>;
  listPresetsCatalog: () => Promise<string[]>;
  listToolsCatalog: (state: GovernanceState) => string[];
  validateAndCreateSkillWithQuality: RegisterAllToolsDeps["validateAndCreateSkillWithQuality"];
  validateAndCreatePresetWithQuality: RegisterAllToolsDeps["validateAndCreatePresetWithQuality"];
  validateAndCreateToolWithQuality: RegisterAllToolsDeps["validateAndCreateToolWithQuality"];
}

interface CustomToolDeps {
  registerCustomTool: RegisterAllToolsDeps["registerCustomTool"];
  unregisterCustomTool: (name: string) => void;
  refreshDisabledToolsCache: () => Promise<void>;
}

export interface BuildRegisterAllToolsDepsOptions
  extends ToolCoreDeps,
    ChatAndSessionDeps,
    GovernanceAndEventDeps,
    PresetAndPromptDeps,
    MemoryAndIoDeps,
    SearchAndCatalogDeps,
    CustomToolDeps {}