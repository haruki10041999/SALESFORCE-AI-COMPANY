import { z } from "zod";
import { registerAnalysisDomain } from "./domain-analysis.js";
import { registerChatDomain } from "./domain-chat.js";
import { registerHistoryContextDomain } from "./domain-history-context.js";
import { registerResourceDomain } from "./domain-resource.js";
import type { GovTool } from "@mcp/tool-types.js";
import type { GovernanceState } from "../governance/governance-state.js";
import type { SystemEventName, SystemEventRecord } from "../event/system-event-manager.js";
import type {
  AgentMessage,
  ChatSession,
  ChatPreset,
  StoredPreset,
  CustomToolDefinition,
  ResourceOperation,
  TriggerRule,
  OrchestrationSession,
  HandlersDashboardState,
  ExportStatistics
} from "../types/index.js";

interface RegisterAllToolsDeps {
  govTool: GovTool;
  chatInputSchema: Record<string, unknown>;
  triggerRuleSchema: z.ZodTypeAny;
  runChatTool: (input: {
    topic: string;
    filePaths?: string[];
    agents?: string[];
    persona?: string;
    skills?: string[];
    turns?: number;
    maxContextChars?: number;
    appendInstruction?: string;
  }) => Promise<{ content: Array<{ type: string; text: string }> }>;
  generateSessionId: () => string;
  filterDisabledSkills: (skills: string[]) => Promise<{ enabled: string[]; disabled: string[] }>;
  emitSystemEvent: (event: string, payload: Record<string, unknown>) => Promise<void>;
  buildChatPrompt: (
    topic: string,
    agentNames: string[],
    personaName?: string,
    skillNames?: string[],
    filePaths?: string[],
    turns?: number,
    maxContextChars?: number,
    appendInstruction?: string,
    includeProjectContext?: boolean
  ) => Promise<string>;
  evaluatePseudoHooks: (
    lastAgent: string,
    lastMessage: string,
    triggerRules: TriggerRule[],
    firedRules: string[]
  ) => { nextAgents: string[]; fired: string[]; reasons: string[] };
  orchestrationSessions: Map<string, OrchestrationSession>;
  saveOrchestrationSession: (sessionId: string) => Promise<{ sessionId: string; filePath: string; historyCount: number } | null>;
  saveSessionHistory: (topic: string, entries: AgentMessage[]) => Promise<string>;
  restoreOrchestrationSession: (sessionId: string) => Promise<OrchestrationSession | null>;
  root: string;
  agentLog: AgentMessage[];
  loadSystemEvents: (limit?: number, event?: SystemEventName) => Promise<SystemEventRecord[]>;
  loadGovernanceState: () => Promise<GovernanceState>;
  saveGovernanceState: (state: GovernanceState) => Promise<void>;
  buildDefaultGovernanceState: () => GovernanceState;
  normalizeProtectedTools: (names: string[]) => string[];
  saveChatHistory: (topic: string) => Promise<string>;
  loadChatHistories: () => Promise<ChatSession[]>;
  restoreChatHistory: (id: string) => Promise<ChatSession | null>;
  listMdFiles: (dir: string) => { name: string; summary: string }[];
  getMdFile: (dir: string, name: string) => string;
  listPresetsData: () => Promise<StoredPreset[]>;
  scoreByQuery: (query: string, ...targets: string[]) => number;
  lowRelevanceScoreThreshold: number;
  registeredToolMetadata: Map<string, { title?: string; description?: string; tags?: string[] }>;
  createPreset: (preset: ChatPreset) => Promise<void>;
  getPreset: (name: string) => Promise<StoredPreset | null>;
  isPresetDisabled: (name: string) => Promise<boolean>;
  getSystemEventLogStatus: () => Promise<{
    eventDir: string;
    activeLogPath: string;
    activeLogExists: boolean;
    activeLogSizeBytes: number;
    archiveCount: number;
    archiveTotalSizeBytes: number;
    archives: Array<{ file: string; sizeBytes: number; modifiedAt: string }>;
  }>;
  generateHandlersDashboard: (state: HandlersDashboardState) => HandlersDashboardState;
  handlersState: HandlersDashboardState;
  exportStatisticsAsCsv: (stats: ExportStatistics) => string;
  exportStatisticsAsJson: (stats: ExportStatistics) => string;
  ensureDir: (path: string) => Promise<void>;
  addMemory: (text: string) => void;
  searchMemory: (query: string) => string[];
  listMemory: () => string[];
  clearMemory: () => void;
  findMdFilesRecursive: (dir: string) => string[];
  toPosixPath: (pathValue: string) => string;
  addRecord: (record: { id: string; text: string; tags: string[] }) => void;
  searchByKeyword: (query: string) => Array<{ id: string; text: string; tags?: string[] }>;
  /** F-11: vector backend (ngram/ollama) 経由の async 検索 */
  searchByKeywordAsync?: (
    query: string,
    options?: { limit?: number; minScore?: number }
  ) => Promise<Array<{ id: string; text: string; tags?: string[]; score?: number }>>;
  buildPrompt: (
    agent: { name: string; content: string },
    task: string,
    options?: { strategy?: "auto" | "plan" | "reflect" | "tree-of-thought" }
  ) => string;
  evaluatePromptMetrics: (prompt: string, skills?: string[], triggerKeywords?: string[]) => {
    lengthChars: number;
    lineCount: number;
    estimatedTokens: number;
    containsProjectContext: boolean;
    containsAgentsSection: boolean;
    containsSkillsSection: boolean;
    containsTaskSection: boolean;
    matchedSkillCount: number;
    totalSkillCount: number;
    matchedTriggerCount: number;
    totalTriggerCount: number;
    skillCoverageRate: number;
    triggerMatchRate: number;
  };
  presetsDir: string;
  toolProposalsDir: string;
  customToolsDir: string;
  governanceFile: string;
  loadRecentOperations: () => Promise<ResourceOperation[]>;
  checkDailyLimitExceeded: (ops: ResourceOperation[], action: "create" | "delete", limit: number) => boolean;
  listSkillsCatalog: () => Promise<string[]>;
  listPresetsCatalog: () => Promise<string[]>;
  listToolsCatalog: (state: GovernanceState) => string[];
  validateAndCreateSkillWithQuality: (
    name: string,
    content: string,
    state: GovernanceState
  ) => Promise<{ success: boolean; message: string; qualityScore?: number }>;
  validateAndCreatePresetWithQuality: (
    name: string,
    preset: { description: string; agents: string[]; topic: string },
    state: GovernanceState
  ) => Promise<{ success: boolean; message: string; qualityScore?: number }>;
  validateAndCreateToolWithQuality: (
    name: string,
    description: string,
    state: GovernanceState
  ) => Promise<{ success: boolean; message: string; qualityScore?: number }>;
  registerCustomTool: (tool: CustomToolDefinition) => void;
  unregisterCustomTool: (name: string) => void;
  refreshDisabledToolsCache: () => Promise<void>;
  appendOperationLog: (operation: ResourceOperation) => Promise<void>;
  emitEvent: (event: { type: string; timestamp: string; payload: Record<string, unknown> }) => Promise<void>;
  resourceScore: (usage: number, bugSignals: number) => number;
}

export function registerAllTools(deps: RegisterAllToolsDeps): void {
  registerAnalysisDomain(deps);
  registerChatDomain(deps);
  registerHistoryContextDomain(deps);
  registerResourceDomain(deps);
}
