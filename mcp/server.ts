// @ts-nocheck
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFileSync, existsSync, promises as fsPromises } from "fs";
import { join, resolve, relative } from "path";
import { pathToFileURL } from "url";
import { analyzeApex } from "./tools/apex-analyzer.js";
import { analyzeLwc } from "./tools/lwc-analyzer.js";
import { buildDeployCommand } from "./tools/deploy-org.js";
import { buildTestCommand } from "./tools/run-tests.js";
import { summarizeBranchDiff } from "./tools/branch-diff-summary.js";
import { buildBranchDiffPrompt } from "./tools/branch-diff-to-prompt.js";
import { checkPrReadiness } from "./tools/pr-readiness-check.js";
import { scanSecurityDelta } from "./tools/security-delta-scan.js";
import { summarizeDeploymentImpact } from "./tools/deployment-impact-summary.js";
import { suggestChangedTests } from "./tools/changed-tests-suggest.js";

// ============================================================
// Core Modules
// ============================================================
import {
  scoreCandidate,
  type ResourceCandidate,
  type ScoringConfig,
  selectResourcesByType,
  DEFAULT_SCORING_CONFIG
} from "./core/resource/resource-selector.js";
import {
  detectGap,
  detectGapsForTopic
} from "./core/resource/resource-gap-detector.js";
import {
  suggestResource,
  suggestResourcesForGaps
} from "./core/resource/resource-suggester.js";
import { rankSkillNamesByTopic, scoreByQuery } from "./core/resource/topic-skill-ranking.js";
import {
  resolveProjectRootFromFile,
  findMdFilesRecursive,
  toPosixPath,
  truncateContent,
  listMdFiles as listMdFilesFromCatalog,
  getMdFile as getMdFileFromCatalog,
  getMdFileAsync as getMdFileAsyncFromCatalog
} from "./core/context/markdown-catalog.js";
import {
  createCustomToolRegistry,
  type CustomToolDefinition
} from "./core/resource/custom-tool-registry.js";
import {
  validateSkillCreation,
  validatePresetCreation,
  validateToolCreation
} from "./core/quality/resource-validation.js";
import {
  type SystemEvent,
  getGlobalDispatcher,
  onEvent,
  emitEvent,
  createResourceCreatedEvent
} from "./core/event/event-dispatcher.js";
import {
  createSystemEventManager,
  summarizeValue,
  type SystemEventName
} from "./core/event/system-event-manager.js";

// ============================================================
// Phase 5: Handlers Auto-Initialization
// ============================================================
import {
  initializeHandlersState,
  autoInitializeHandlers,
  generateHandlersDashboard,
  type HandlersState
} from "./handlers/auto-init.js";
import { registerCoreAnalysisTools } from "./handlers/register-core-analysis-tools.js";
import { registerBranchReviewTools } from "./handlers/register-branch-review-tools.js";
import { registerResourceCatalogTools } from "./handlers/register-resource-catalog-tools.js";
import { registerChatOrchestrationTools } from "./handlers/register-chat-orchestration-tools.js";
import { registerLoggingTools } from "./handlers/register-logging-tools.js";
import { registerHistoryTools } from "./handlers/register-history-tools.js";
import { registerResourceSearchTools } from "./handlers/register-resource-search-tools.js";
import { registerPresetTools } from "./handlers/register-preset-tools.js";
import { registerResourceGovernanceTools } from "./handlers/register-resource-governance-tools.js";
import { registerResourceActionTools } from "./handlers/register-resource-action-tools.js";
import { registerSmartChatTools } from "./handlers/register-smart-chat-tools.js";
import { registerAnalyticsTools } from "./handlers/register-analytics-tools.js";
import { registerExportTools } from "./handlers/register-export-tools.js";
import { registerMemoryTools } from "./handlers/register-memory-tools.js";
import { registerContextTools } from "./handlers/register-context-tools.js";
import { registerVectorPromptTools } from "./handlers/register-vector-prompt-tools.js";
import { registerBatchTools } from "./handlers/register-batch-tools.js";
import { registerKamilessTools } from "./handlers/register-kamiless-tools.js";

// ============================================================
// Memory / Prompt-Engine / Statistics
// ============================================================
import { addMemory, searchMemory, listMemory, clearMemory } from "../memory/project-memory.js";
import { addRecord, searchByKeyword } from "../memory/vector-store.js";
import { buildPrompt } from "../prompt-engine/prompt-builder.js";
import {
  exportStatisticsAsCsv,
  exportStatisticsAsJson,
  type HandlersStatistics
} from "./handlers/statistics-manager.js";
import {
  checkDailyLimitExceeded,
  type ResourceOperation
} from "./core/governance/governance-manager.js";
import { createOperationLog } from "./core/governance/operation-log.js";
import {
  normalizeDisabledEntries as _normalizeDisabledEntries,
  normalizeProtectedTools as _normalizeProtectedTools,
  buildDefaultGovernanceState as _buildDefaultGovernanceState,
  loadGovernanceState as _loadGovernanceState,
  saveGovernanceState as _saveGovernanceState,
  type GovernedResourceType,
  type GovernanceActionType,
  type GovernanceConfig,
  type GovernanceState
} from "./core/governance/governance-state.js";
import { createPresetStore, type ChatPreset } from "./core/context/preset-store.js";
import { createCatalogHelpers } from "./core/context/catalog-helpers.js";

// Resolve project root from this file location so cross-repo clients can share one server.
const ROOT = resolveProjectRootFromFile(import.meta.url);

function listMdFiles(dir: string): { name: string; summary: string }[] {
  return listMdFilesFromCatalog(ROOT, dir);
}

function getMdFile(dir: string, name: string): string {
  return getMdFileFromCatalog(ROOT, dir, name);
}

function getMdFileAsync(dir: string, name: string): Promise<string> {
  return getMdFileAsyncFromCatalog(ROOT, dir, name);
}

async function buildChatPrompt(
  topic: string,
  agentNames: string[],
  personaName: string | undefined,
  skillNames: string[],
  filePaths: string[],
  turns: number,
  maxContextChars?: number,
  appendInstruction?: string
): Promise<string> {
  const selectedAgents = agentNames.length > 0 ? agentNames : ["product-manager", "architect", "qa-engineer"];

  const contextDir = join(ROOT, "context");
  const contextFiles = existsSync(contextDir) ? findMdFilesRecursive(contextDir) : [];

  const totalItems = filePaths.length + selectedAgents.length + skillNames.length + (personaName ? 1 : 0) + contextFiles.length;
  const perItemBudget = maxContextChars && totalItems > 0
    ? Math.floor(maxContextChars / Math.max(totalItems, 1))
    : undefined;

  const [codeResults, agentResults, skillResults, personaResult] = await Promise.all([
    // コードファイルを並列読み込み
    Promise.all(filePaths.map(async (fp) => {
      try {
        const code = await fsPromises.readFile(fp, "utf-8");
        const ext = fp.split(".").pop() ?? "";
        const content = perItemBudget ? truncateContent(code, perItemBudget, fp) : code;
        return `### ${fp}\n\`\`\`${ext}\n${content}\n\`\`\``;
      } catch {
        return `### ${fp}\n(読み込み失敗)`;
      }
    })),
    // エージェント定義を並列読み込み
    Promise.all(selectedAgents.map(async (name) => {
      try {
        const raw = await getMdFileAsync("agents", name);
        const content = perItemBudget ? truncateContent(raw, perItemBudget, `agent:${name}`) : raw;
        return `### ${name}\n${content}`;
      } catch {
        return `### ${name}\n(未定義)`;
      }
    })),
    Promise.all(skillNames.map(async (name) => {
      try {
        const raw = await getMdFileAsync("skills", name);
        const content = perItemBudget ? truncateContent(raw, perItemBudget, `skill:${name}`) : raw;
        return `### ${name}\n${content}`;
      } catch {
        return `### ${name}\n(未定義)`;
      }
    })),
    // ペルソナを並列で取得
    personaName
      ? getMdFileAsync("personas", personaName).catch(() => null)
      : Promise.resolve(null)
  ]);

  const sections: string[] = [];
  const reviewModeTriggered = filePaths.length > 0 || /レビュー|確認|チェック/.test(topic);

  // FEAT-A: context/ ディレクトリを自動注入（maxContextChars 予算を考慮）
  if (contextFiles.length > 0) {
    const contextContent = contextFiles
      .map((f) => {
        const raw = readFileSync(f, "utf-8");
        return perItemBudget
          ? truncateContent(raw, perItemBudget, `context:${toPosixPath(relative(ROOT, f))}`)
          : raw;
      })
      .join("\n\n");
    if (contextContent.trim()) {
      sections.push(`## プロジェクトコンテキスト\n\n${contextContent}`);
    }
  }

  if (codeResults.length > 0) {
    sections.push(`## コードコンテキスト\n\n${codeResults.join("\n\n")}`);
  }

  sections.push(`## 参加エージェント定義\n\n${agentResults.join("\n\n")}`);

  if (skillResults.length > 0) {
    sections.push(`## 適用スキル\n\n${skillResults.join("\n\n")}`);
  }

  const personaContent = personaResult && perItemBudget
    ? truncateContent(personaResult, perItemBudget, `persona:${personaName ?? ""}`)
    : personaResult;
  if (personaContent) {
    sections.push(`## ペルソナ\n\n${personaContent}`);
  }

  const discussionFrameworkPath = join(ROOT, "prompt-engine", "discussion-framework.md");
  if (existsSync(discussionFrameworkPath)) {
    const raw = readFileSync(discussionFrameworkPath, "utf-8");
    const content = perItemBudget ? truncateContent(raw, perItemBudget, "discussion-framework") : raw;
    sections.push(`## ディスカッション規約\n\n${content}`);
  }

  if (filePaths.length > 0) {
    const reviewFrameworkPath = join(ROOT, "prompt-engine", "review-framework.md");
    if (existsSync(reviewFrameworkPath)) {
      const raw = readFileSync(reviewFrameworkPath, "utf-8");
      const content = perItemBudget ? truncateContent(raw, perItemBudget, "review-framework") : raw;
      sections.push(`## レビュー観点\n\n${content}`);
    }
  }

  if (reviewModeTriggered) {
    const reviewModePath = join(ROOT, "prompt-engine", "review-mode.md");
    if (existsSync(reviewModePath)) {
      const reviewModeRaw = readFileSync(reviewModePath, "utf-8");
      const reviewModeContent = perItemBudget
        ? truncateContent(reviewModeRaw, perItemBudget, "review-mode")
        : reviewModeRaw;
      sections.push(`## レビューモード\n\n${reviewModeContent}`);
    }
  }

  const turnInstruction = turns > 0
    ? `複数エージェントで議論し、最大 ${turns} ターンで回答してください。`
    : "単一回答として整理してください。";

  const extraInstruction = appendInstruction
    ? `\n\n### 追加指示\n\n${appendInstruction}`
    : "";

  sections.push(`## タスク\n\nトピック: 「${topic}」\n\n${turnInstruction}\n\nルール:\n- 関連コードがある場合は根拠として参照する\n- 各エージェントの専門性と適用スキルに基づいて回答する\n- 不明点は推測を避け、必要な前提を明示する\n- 重要な設計判断や懸念点を簡潔に示す\n- ペルソナがある場合はその文体で回答する\n- 発言形式は必ず「**agent-name**: 発言内容」を使う（誰の発言か判別できる形にする）${extraInstruction}`);

  return sections.join("\n\n---\n\n");
}

// エージェントメッセージログ
interface AgentMessage {
  agent: string;
  message: string;
  timestamp: string;
  topic?: string;
}

const agentLog: AgentMessage[] = [];
const handlersState = initializeHandlersState();
const OPERATIONS_LOG_FILE = join(ROOT, "outputs", "operations-log.jsonl");
const { loadRecentOperations, appendOperationLog } = createOperationLog({ logFile: OPERATIONS_LOG_FILE, ensureDir });
const LOW_RELEVANCE_SCORE_THRESHOLD = 6;
const DEFAULT_PROTECTED_TOOLS = [
  "apply_resource_actions",
  "get_resource_governance",
  "review_resource_governance",
  "record_resource_signal",
  "get_system_events",
  "get_event_automation_config",
  "update_event_automation_config"
];
const { emitSystemEvent, loadSystemEvents, registerToolFailure } = createSystemEventManager({
  rootDir: ROOT,
  ensureDir,
  applyEventAutomation,
  bridgeCoreEvent: async (event, timestamp, payload) => {
    await emitEvent({
      type: event,
      timestamp,
      payload
    });
  }
});

const server = new McpServer({
  name: "salesforce-ai-company",
  version: "1.0.0"
});

type RegisteredToolHandler = (input: unknown) => Promise<{ content: Array<{ type: string; text: string }> }>;

const registeredToolHandlers = new Map<string, RegisteredToolHandler>();
const registeredToolMetadata = new Map<string, { title?: string; description?: string }>();
const registerToolOriginal = server.registerTool.bind(server);

(server as unknown as {
  registerTool: typeof server.registerTool;
}).registerTool = ((
  name: string,
  config: Parameters<typeof server.registerTool>[1],
  handler: Parameters<typeof server.registerTool>[2]
) => {
  registeredToolHandlers.set(name, handler as RegisteredToolHandler);
  registeredToolMetadata.set(name, {
    title: (config as { title?: string })?.title,
    description: (config as { description?: string })?.description
  });
  return registerToolOriginal(name, config, handler);
}) as typeof server.registerTool;

export function listRegisteredToolNamesForTest(): string[] {
  return [...registeredToolHandlers.keys()].sort();
}

export async function invokeRegisteredToolForTest(name: string, input: unknown): Promise<{ content: Array<{ type: string; text: string }> }> {
  const handler = registeredToolHandlers.get(name);
  if (!handler) {
    throw new Error(`Tool not found: ${name}`);
  }
  return handler(input);
}

// ============================================================
// ガバナンス対応ツール登録ラッパー（disable チェック付き）
// ============================================================

let cachedDisabledTools: Set<string> = new Set();

async function refreshDisabledToolsCache(): Promise<void> {
  try {
    const state = await loadGovernanceState();
    cachedDisabledTools = new Set((state.disabled.tools ?? []).map((name) => normalizeResourceName(name)));
  } catch {
    cachedDisabledTools = new Set();
  }
}

function govTool(
  name: string,
  config: any,
  handler: any
): void {
  server.registerTool(name as any, config as any, (async (input: any) => {
    await emitSystemEvent("tool_before_execute", {
      toolName: name,
      input: summarizeValue(input)
    });

    if (cachedDisabledTools.has(normalizeResourceName(name))) {
      await emitSystemEvent("tool_after_execute", {
        toolName: name,
        success: false,
        blockedByDisable: true,
        error: "tool disabled"
      });
      return {
        content: [
          {
            type: "text",
            text: "ツール \"" + name + "\" は現在無効化されています。apply_resource_actions で enable してから使用してください。"
          }
        ]
      };
    }

    try {
      const result = await (handler as (input: unknown) => Promise<{ content: Array<{ type: string; text: string }> }>)(input);
      await emitSystemEvent("tool_after_execute", {
        toolName: name,
        success: true,
        contentCount: Array.isArray(result?.content) ? result.content.length : 0
      });
      return result;
    } catch (error) {
      await emitSystemEvent("tool_after_execute", {
        toolName: name,
        success: false,
        error: summarizeValue(error, 500)
      });
      await registerToolFailure(name, error);
      throw error;
    }
  }) as any);
}

registerCoreAnalysisTools(govTool);
registerBranchReviewTools(govTool);
registerResourceCatalogTools({ govTool, listMdFiles, getMdFile });

async function suggestSkillsFromTopic(topic: string, limit = 3): Promise<string[]> {
  const skills = listMdFiles("skills");
  return rankSkillNamesByTopic(topic, skills, limit);
}

const chatInputSchema = {
  topic: z.string(),
  filePaths: z.array(z.string()).optional(),
  agents: z.array(z.string()).optional(),
  persona: z.string().optional(),
  skills: z.array(z.string()).optional(),
  turns: z.number().int().min(1).max(30).optional(),
  maxContextChars: z.number().int().min(500).max(200000).optional(),
  appendInstruction: z.string().optional()
};

const triggerRuleSchema = z.object({
  whenAgent: z.string(),
  thenAgent: z.string(),
  messageIncludes: z.string().optional(),
  reason: z.string().optional(),
  once: z.boolean().optional()
});

type TriggerRule = z.infer<typeof triggerRuleSchema>;

interface OrchestrationSession {
  id: string;
  topic: string;
  appendInstruction?: string;
  agents: string[];
  persona?: string;
  skills: string[];
  filePaths: string[];
  turns: number;
  triggerRules: TriggerRule[];
  queue: string[];
  history: AgentMessage[];
  firedRules: string[];
}

const orchestrationSessions = new Map<string, OrchestrationSession>();

function buildRuleKey(rule: TriggerRule): string {
  return rule.whenAgent + "::" + rule.thenAgent + "::" + (rule.messageIncludes ?? "");
}

function evaluatePseudoHooks(
  lastAgent: string,
  lastMessage: string,
  triggerRules: TriggerRule[],
  firedRules: string[]
): { nextAgents: string[]; fired: string[]; reasons: string[] } {
  const nextAgents: string[] = [];
  const fired: string[] = [];
  const reasons: string[] = [];

  for (const rule of triggerRules) {
    if (rule.whenAgent !== lastAgent) {
      continue;
    }

    const ruleKey = buildRuleKey(rule);
    if (rule.once && firedRules.includes(ruleKey)) {
      continue;
    }

    if (rule.messageIncludes) {
      const includeWord = rule.messageIncludes.toLowerCase();
      if (!lastMessage.toLowerCase().includes(includeWord)) {
        continue;
      }
    }

    nextAgents.push(rule.thenAgent);
    fired.push(ruleKey);
    reasons.push(rule.reason ?? (rule.whenAgent + " -> " + rule.thenAgent));
  }

  return {
    nextAgents: [...new Set(nextAgents)],
    fired,
    reasons
  };
}

function generateSessionId(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  return "orch-" + ts;
}

function normalizeResourceName(name: string): string {
  return toPosixPath(name).replace(/\.md$/, "").toLowerCase();
}

async function getDisabledResourceSet(resourceType: GovernedResourceType): Promise<Set<string>> {
  const state = await loadGovernanceState();
  return new Set((state.disabled[resourceType] ?? []).map((x) => normalizeResourceName(x)));
}

async function filterDisabledSkills(skillNames: string[]): Promise<{ enabled: string[]; disabled: string[] }> {
  const disabledSet = await getDisabledResourceSet("skills");
  if (skillNames.length === 0 || disabledSet.size === 0) {
    return { enabled: skillNames, disabled: [] };
  }

  const enabled: string[] = [];
  const disabled: string[] = [];

  for (const skillName of skillNames) {
    const normalized = normalizeResourceName(skillName);
    const baseName = normalized.split("/").pop() ?? normalized;
    const matched = disabledSet.has(normalized) || disabledSet.has(baseName);
    if (matched) {
      disabled.push(skillName);
      continue;
    }
    enabled.push(skillName);
  }

  return { enabled, disabled };
}

async function isPresetDisabled(presetName: string): Promise<boolean> {
  const disabledSet = await getDisabledResourceSet("presets");
  const normalized = normalizeResourceName(presetName);
  return disabledSet.has(normalized);
}

async function runChatTool({
  topic,
  filePaths,
  agents,
  persona,
  skills,
  turns,
  maxContextChars,
  appendInstruction
}: {
  topic: string;
  filePaths?: string[];
  agents?: string[];
  persona?: string;
  skills?: string[];
  turns?: number;
  maxContextChars?: number;
  appendInstruction?: string;
}) {
  const requestedSkills = skills ?? [];
  const autoSkills = requestedSkills.length === 0 ? await suggestSkillsFromTopic(topic, 3) : [];
  const effectiveSkills = requestedSkills.length > 0 ? requestedSkills : autoSkills;
  const { enabled: enabledSkills } = await filterDisabledSkills(effectiveSkills);

  if (requestedSkills.length === 0 && autoSkills.length === 0) {
    await emitSystemEvent("low_relevance_detected", {
      source: "chat:auto-skill-selection",
      topic,
      reason: "no skills selected from topic"
    });
  }

  const prompt = await buildChatPrompt(
    topic,
    agents ?? [],
    persona,
    enabledSkills,
    filePaths ?? [],
    turns ?? 6,
    maxContextChars,
    appendInstruction
  );

  return {
    content: [
      {
        type: "text" as const,
        text: prompt
      }
    ]
  };
}

const HISTORY_DIR = join(ROOT, "outputs", "history");
const PRESETS_DIR = join(ROOT, "outputs", "presets");
const SESSIONS_DIR = join(ROOT, "outputs", "sessions");

async function ensureDir(dir: string): Promise<void> {
  if (!existsSync(dir)) {
    await fsPromises.mkdir(dir, { recursive: true });
  }
}

const { createPreset, listPresetsData, getPreset } = createPresetStore({ presetsDir: PRESETS_DIR, ensureDir });

registerChatOrchestrationTools({
  govTool,
  chatInputSchema,
  triggerRuleSchema,
  runChatTool,
  generateSessionId,
  filterDisabledSkills,
  emitSystemEvent,
  buildChatPrompt,
  evaluatePseudoHooks,
  orchestrationSessions,
  saveOrchestrationSession,
  restoreOrchestrationSession,
  sessionsDir: join(ROOT, "outputs", "sessions"),
  readDir: (path) => fsPromises.readdir(path),
  readFile: (path, encoding) => fsPromises.readFile(path, encoding)
});

registerLoggingTools({
  govTool,
  agentLog,
  loadSystemEvents,
  loadGovernanceState,
  saveGovernanceState,
  buildDefaultGovernanceState,
  normalizeProtectedTools
});

registerHistoryTools({
  govTool,
  agentLog,
  saveChatHistory,
  loadChatHistories,
  restoreChatHistory,
  emitSystemEvent
});

registerResourceSearchTools({
  govTool,
  loadGovernanceState,
  listMdFiles,
  listPresetsData,
  scoreByQuery,
  emitSystemEvent,
  lowRelevanceScoreThreshold: LOW_RELEVANCE_SCORE_THRESHOLD,
  registeredToolMetadata
});

registerPresetTools({
  govTool,
  createPreset,
  listPresetsData,
  getPreset,
  isPresetDisabled,
  filterDisabledSkills,
  buildChatPrompt,
  emitSystemEvent
});

// ============================================================
// 永続化・共有ヘルパー
// ============================================================

interface ChatSession {
  id: string;
  timestamp: string;
  topic: string;
  agents: string[];
  entries: AgentMessage[];
}

async function saveChatHistory(topic: string): Promise<string> {
  await ensureDir(HISTORY_DIR);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const id = timestamp.split("T")[0] + "-" + timestamp.split("T")[1].slice(0, 6);
  
  const session: ChatSession = {
    id,
    timestamp: new Date().toISOString(),
    topic,
    agents: [...new Set(agentLog.map((e) => e.agent))],
    entries: agentLog.filter((e) => e.topic === topic || !e.topic)
  };
  
  const filePath = join(HISTORY_DIR, id + ".json");
  await fsPromises.writeFile(filePath, JSON.stringify(session, null, 2));
  
  return id;
}

async function loadChatHistories(): Promise<ChatSession[]> {
  if (!existsSync(HISTORY_DIR)) {
    return [];
  }
  
  const files = await fsPromises.readdir(HISTORY_DIR);
  const sessions: ChatSession[] = [];
  
  for (const file of files) {
    if (file.endsWith(".json")) {
      try {
        const content = await fsPromises.readFile(join(HISTORY_DIR, file), "utf-8");
        sessions.push(JSON.parse(content));
      } catch {
        // skip corrupted files
      }
    }
  }
  
  return sessions.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

async function restoreChatHistory(id: string): Promise<ChatSession | null> {
  const filePath = join(HISTORY_DIR, id + ".json");
  try {
    const content = await fsPromises.readFile(filePath, "utf-8");
    const session = JSON.parse(content) as ChatSession;
    agentLog.length = 0;
    agentLog.push(...session.entries);
    return session;
  } catch {
    return null;
  }
}

async function saveOrchestrationSession(sessionId: string): Promise<{ sessionId: string; filePath: string; historyCount: number } | null> {
  const session = orchestrationSessions.get(sessionId);
  if (!session) {
    return null;
  }

  await ensureDir(SESSIONS_DIR);
  const filePath = join(SESSIONS_DIR, sessionId + ".json");
  await fsPromises.writeFile(filePath, JSON.stringify(session, null, 2), "utf-8");

  return {
    sessionId,
    filePath: toPosixPath(relative(ROOT, filePath)),
    historyCount: session.history.length
  };
}

async function restoreOrchestrationSession(sessionId: string): Promise<OrchestrationSession | null> {
  const filePath = join(SESSIONS_DIR, sessionId + ".json");
  try {
    const content = await fsPromises.readFile(filePath, "utf-8");
    const session = JSON.parse(content) as OrchestrationSession;
    orchestrationSessions.set(session.id, session);
    return session;
  } catch {
    return null;
  }
}

// ============================================================
// Resource Governance（スキル・ツール・プリセット管理）
// ============================================================

const GOVERNANCE_FILE = join(ROOT, "outputs", "resource-governance.json");
const TOOL_PROPOSALS_DIR = join(ROOT, "outputs", "tool-proposals");
const CUSTOM_TOOLS_DIR = join(ROOT, "outputs", "custom-tools");

const { loadedCustomToolNames, registerCustomTool, unregisterCustomTool, loadCustomToolsFromDir } = createCustomToolRegistry({
  govTool,
  filterDisabledSkills,
  buildChatPrompt
});

registerSmartChatTools({
  govTool,
  root: ROOT,
  filterDisabledSkills,
  buildChatPrompt
});

registerAnalyticsTools({
  govTool,
  agentLog,
  loadChatHistories,
  generateHandlersDashboard,
  handlersState,
  exportStatisticsAsCsv,
  exportStatisticsAsJson,
  ensureDir
});

registerExportTools({
  govTool,
  agentLog,
  loadChatHistories,
  ensureDir
});

registerMemoryTools({
  govTool,
  addMemory,
  searchMemory,
  listMemory,
  clearMemory
});

registerContextTools({
  govTool,
  root: ROOT,
  findMdFilesRecursive,
  toPosixPath
});

registerVectorPromptTools({
  govTool,
  addRecord,
  searchByKeyword,
  buildPrompt
});

registerBatchTools({
  govTool,
  buildChatPrompt
});

registerKamilessTools({
  govTool,
  root: ROOT
});

const BUILTIN_TOOL_CATALOG = [
  "repo_analyze",
  "apex_analyze",
  "lwc_analyze",
  "deploy_org",
  "run_tests",
  "branch_diff_summary",
  "branch_diff_to_prompt",
  "pr_readiness_check",
  "security_delta_scan",
  "deployment_impact_summary",
  "changed_tests_suggest",
  "list_agents",
  "get_agent",
  "list_skills",
  "get_skill",
  "list_personas",
  "chat",
  "simulate_chat",
  "orchestrate_chat",
  "evaluate_triggers",
  "dequeue_next_agent",
  "get_orchestration_session",
  "save_orchestration_session",
  "restore_orchestration_session",
  "list_orchestration_sessions",
  "record_agent_message",
  "get_agent_log",
  "parse_and_record_chat",
  "get_system_events",
  "get_event_automation_config",
  "update_event_automation_config",
  "save_chat_history",
  "load_chat_history",
  "restore_chat_history",
  "create_preset",
  "list_presets",
  "run_preset",
  "search_resources",
  "auto_select_resources",
  "smart_chat",
  "analyze_chat_trends",
  "get_handlers_dashboard",
  "export_handlers_statistics",
  "export_to_markdown",
  "batch_chat",
  "add_memory",
  "search_memory",
  "list_memory",
  "clear_memory",
  "add_vector_record",
  "search_vector",
  "build_prompt",
  "get_context"
];

const { listSkillsCatalog, listPresetsCatalog, listToolsCatalog, resourceScore, getCatalogCounts } = createCatalogHelpers({
  skillsDir: join(ROOT, "skills"),
  findMdFilesRecursive,
  toPosixPath,
  relative,
  listPresetsData,
  builtinToolCatalog: BUILTIN_TOOL_CATALOG,
  loadedCustomToolNames
});

registerResourceGovernanceTools({
  govTool,
  loadGovernanceState,
  saveGovernanceState,
  getCatalogCounts,
  listSkillsCatalog,
  listPresetsCatalog,
  listToolsCatalog,
  resourceScore,
  emitSystemEvent
});

registerResourceActionTools({
  govTool,
  root: ROOT,
  presetsDir: PRESETS_DIR,
  toolProposalsDir: TOOL_PROPOSALS_DIR,
  customToolsDir: CUSTOM_TOOLS_DIR,
  governanceFile: GOVERNANCE_FILE,
  loadGovernanceState,
  saveGovernanceState,
  ensureDir,
  loadRecentOperations,
  checkDailyLimitExceeded,
  listSkillsCatalog,
  listPresetsCatalog,
  listToolsCatalog,
  validateAndCreateSkillWithQuality,
  validateAndCreatePresetWithQuality,
  validateAndCreateToolWithQuality,
  createPreset,
  registerCustomTool,
  unregisterCustomTool,
  refreshDisabledToolsCache,
  appendOperationLog,
  emitEvent,
  toPosixPath
});

function buildDefaultGovernanceState(): GovernanceState {
  return _buildDefaultGovernanceState(DEFAULT_PROTECTED_TOOLS);
}

async function loadGovernanceState(): Promise<GovernanceState> {
  return _loadGovernanceState(GOVERNANCE_FILE, ensureDir, DEFAULT_PROTECTED_TOOLS);
}

async function saveGovernanceState(state: GovernanceState): Promise<void> {
  return _saveGovernanceState(GOVERNANCE_FILE, state);
}

function normalizeDisabledEntries(names: string[]): string[] {
  return _normalizeDisabledEntries(names);
}

function normalizeProtectedTools(names: string[]): string[] {
  return _normalizeProtectedTools(names, DEFAULT_PROTECTED_TOOLS);
}

async function setToolDisabledState(toolName: string, disabled: boolean): Promise<{ changed: boolean; disabledTools: string[] }> {
  const state = await loadGovernanceState();
  const normalizedName = normalizeResourceName(toolName);
  const current = new Set((state.disabled.tools ?? []).map((name) => normalizeResourceName(name)));

  if (disabled) {
    current.add(normalizedName);
  } else {
    current.delete(normalizedName);
  }

  const nextDisabledTools = normalizeDisabledEntries([...current]);
  const changed = JSON.stringify(nextDisabledTools) !== JSON.stringify(normalizeDisabledEntries(state.disabled.tools ?? []));
  if (changed) {
    state.disabled.tools = nextDisabledTools;
    state.config.eventAutomation.protectedTools = normalizeProtectedTools(state.config.eventAutomation.protectedTools ?? []);
    await saveGovernanceState(state);
    await refreshDisabledToolsCache();
  }

  return {
    changed,
    disabledTools: nextDisabledTools
  };
}

async function applyEventAutomation(event: SystemEventName, payload: Record<string, unknown>): Promise<void> {
  try {
    const defaults = buildDefaultGovernanceState().config.eventAutomation;
    const state = await loadGovernanceState();
    const automation = {
      ...defaults,
      ...state.config.eventAutomation,
      protectedTools: normalizeProtectedTools(state.config.eventAutomation?.protectedTools ?? defaults.protectedTools),
      rules: {
        ...defaults.rules,
        ...state.config.eventAutomation?.rules,
        errorAggregateDetected: {
          ...defaults.rules.errorAggregateDetected,
          ...state.config.eventAutomation?.rules?.errorAggregateDetected
        },
        governanceThresholdExceeded: {
          ...defaults.rules.governanceThresholdExceeded,
          ...state.config.eventAutomation?.rules?.governanceThresholdExceeded
        }
      }
    };

    if (!automation.enabled) {
      return;
    }

    const protectedTools = new Set((automation.protectedTools ?? []).map((name) => normalizeResourceName(name)));

    if (event === "error_aggregate_detected" && automation.rules.errorAggregateDetected.autoDisableTool) {
      const rawToolName = typeof payload.toolName === "string" ? payload.toolName : "";
      const toolName = normalizeResourceName(rawToolName);
      if (!toolName) {
        payload.automation = { action: "skip", reason: "missing-tool-name" };
        return;
      }
      if (protectedTools.has(toolName)) {
        payload.automation = { action: "skip", reason: "protected-tool", toolName };
        return;
      }

      const disabledSet = new Set((state.disabled.tools ?? []).map((name) => normalizeResourceName(name)));
      if (disabledSet.has(toolName)) {
        payload.automation = { action: "skip", reason: "already-disabled", toolName };
        return;
      }

      const result = await setToolDisabledState(toolName, true);
      payload.automation = {
        action: result.changed ? "disable-tool" : "skip",
        toolName,
        changed: result.changed,
        disabledTools: result.disabledTools
      };
      return;
    }

    if (event === "governance_threshold_exceeded" && automation.rules.governanceThresholdExceeded.autoDisableRecommendedTools) {
      const recommendations = Array.isArray(payload.recommendations)
        ? payload.recommendations as Array<{ resourceType?: string; action?: string; name?: string }>
        : [];
      const limit = Math.max(0, automation.rules.governanceThresholdExceeded.maxToolsPerRun ?? 0);
      const toolRecommendations = recommendations
        .filter((item) => item.resourceType === "tools" && item.action === "disable" && typeof item.name === "string")
        .slice(0, limit);

      const applied: string[] = [];
      const skipped: Array<{ toolName: string; reason: string }> = [];

      for (const item of toolRecommendations) {
        const toolName = normalizeResourceName(item.name ?? "");
        if (!toolName) {
          continue;
        }
        if (protectedTools.has(toolName)) {
          skipped.push({ toolName, reason: "protected-tool" });
          continue;
        }
        const result = await setToolDisabledState(toolName, true);
        if (result.changed) {
          applied.push(toolName);
        } else {
          skipped.push({ toolName, reason: "already-disabled" });
        }
      }

      payload.automation = {
        action: "disable-recommended-tools",
        applied,
        skipped,
        limit
      };
    }
  } catch (error) {
    payload.automation = {
      action: "error",
      message: summarizeValue(error, 300)
    };
  }
}

// ============================================================
// プリセットツール
// ============================================================



// ============================================================
// バッチ処理ツール
// ============================================================

// ============================================================
// Helper Functions for Resource Validation & Creation
// ============================================================

/**
 * リソース作成時の検証関数
 * 品質チェック、重複排除、ガバナンス確認を統合
 */
async function validateAndCreateSkillWithQuality(
  skillName: string,
  skillContent: string,
  state: any // GovernanceState
): Promise<{
  success: boolean;
  message: string;
  qualityScore?: number;
  duplicateFound?: boolean;
}> {
  const existingSkills = await listSkillsCatalog();
  return validateSkillCreation(skillName, skillContent, existingSkills);
}

/**
 * プリセット作成時の検証関数
 */
async function validateAndCreatePresetWithQuality(
  presetName: string,
  presetData: {
    description: string;
    agents: string[];
    topic: string;
  },
  state: any // GovernanceState
): Promise<{
  success: boolean;
  message: string;
  qualityScore?: number;
  duplicateFound?: boolean;
}> {
  const existingPresets = await listPresetsCatalog();
  return validatePresetCreation(presetName, presetData, existingPresets);
}

/**
 * ツール作成時の検証関数
 */
async function validateAndCreateToolWithQuality(
  toolName: string,
  toolDescription: string,
  state: any // GovernanceState
): Promise<{
  success: boolean;
  message: string;
  qualityScore?: number;
  duplicateFound?: boolean;
}> {
  const existingTools = listToolsCatalog(state);
  return validateToolCreation(toolName, toolDescription, existingTools);
}

async function main(): Promise<void> {
  // 起動時: カスタムツールを読み込み登録、disabled キャッシュを初期化
  await loadCustomToolsFromDir(CUSTOM_TOOLS_DIR);
  await refreshDisabledToolsCache();

  // ============================================================
  // Phase 5: Auto-Initialize Handlers (Event-Driven Auto-Execution)
  // ============================================================
  autoInitializeHandlers(handlersState);
  console.error("[Server] Handlers auto-initialization complete");

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const isDirectRun = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href === import.meta.url
  : false;

if (isDirectRun) {
  main().catch((error) => {
    console.error("MCP server failed to start", error);
    process.exit(1);
  });
}

