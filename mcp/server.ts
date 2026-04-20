// @ts-nocheck
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFileSync, readdirSync, existsSync, statSync, promises as fsPromises } from "fs";
import { join, basename, dirname, resolve, relative } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { analyzeRepo } from "./tools/repo-analyzer.js";
import { analyzeApex } from "./tools/apex-analyzer.js";
import { analyzeLwc } from "./tools/lwc-analyzer.js";
import { buildDeployCommand } from "./tools/deploy-org.js";
import { buildTestCommand } from "./tools/run-tests.js";
import { summarizeBranchDiff } from "./tools/branch-diff-summary.js";
import { buildBranchDiffPrompt } from "./tools/branch-diff-to-prompt.js";
import {
  generateKamilessExport,
  generateKamilessSpecFromRequirements
} from "./tools/kamiless-export-generator.js";

// ============================================================
// Core Modules
// ============================================================
import {
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
import {
  checkResourceQuality
} from "./core/quality/quality-checker.js";
import {
  checkForDuplicates,
  generateUniqueName
} from "./core/quality/deduplication.js";
import {
  type SystemEvent,
  getGlobalDispatcher,
  onEvent,
  emitEvent,
  createResourceCreatedEvent
} from "./core/event/event-dispatcher.js";

// ============================================================
// Phase 5: Handlers Auto-Initialization
// ============================================================
import {
  initializeHandlersState,
  autoInitializeHandlers,
  type HandlersState
} from "./handlers/auto-init.js";

// Resolve project root from this file location so cross-repo clients can share one server.
const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_DIR = dirname(THIS_FILE);

function resolveProjectRoot(startDir: string): string {
  let current = startDir;
  for (let i = 0; i < 8; i++) {
    const hasPackageJson = existsSync(join(current, "package.json"));
    const hasAgentsDir = existsSync(join(current, "agents"));
    if (hasPackageJson && hasAgentsDir) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return resolve(startDir, "..", "..");
}

const ROOT = resolveProjectRoot(THIS_DIR);

function findMdFilesRecursive(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir);
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...findMdFilesRecursive(fullPath));
      continue;
    }
    if (entry.endsWith(".md")) {
      files.push(fullPath);
    }
  }

  return files;
}

function toPosixPath(pathValue: string): string {
  return pathValue.replace(/\\/g, "/");
}

function truncateContent(text: string, maxChars: number, label: string): string {
  if (text.length <= maxChars) return text;
  return (
    text.slice(0, maxChars) +
    `\n\n...(${label}: ${text.length.toLocaleString()}文字 → ${maxChars.toLocaleString()}文字に削減)`
  );
}

function listMdFiles(dir: string): { name: string; summary: string }[] {
  const fullDir = join(ROOT, dir);
  const files = findMdFilesRecursive(fullDir);
  return files
    .map((filePath) => {
      const content = readFileSync(filePath, "utf-8");
      const heading = content.split("\n").find((l) => l.startsWith("# ")) ?? "";
      const desc = content.split("\n").find((l) => l.trim() && !l.startsWith("#")) ?? "";
      const name = toPosixPath(relative(fullDir, filePath)).replace(/\.md$/, "");
      return { name, summary: heading.replace(/^# /, "") || desc.trim() };
    });
}

function getMdFile(dir: string, name: string): string {
  const fullDir = join(ROOT, dir);
  if (!existsSync(fullDir)) throw new Error(`Directory not found: ${dir}`);

  const normalizedName = toPosixPath(name).replace(/\.md$/, "");
  const directPath = join(fullDir, `${normalizedName}.md`);
  if (existsSync(directPath)) {
    return readFileSync(directPath, "utf-8");
  }

  const allFiles = findMdFilesRecursive(fullDir);
  const byBaseName = allFiles.filter((p) => basename(p, ".md") === normalizedName);
  if (byBaseName.length === 1) {
    return readFileSync(byBaseName[0], "utf-8");
  }
  if (byBaseName.length > 1) {
    const candidates = byBaseName
      .map((p) => toPosixPath(relative(fullDir, p)).replace(/\.md$/, ""))
      .join(", ");
    throw new Error(`Ambiguous name: ${name}. Use one of: ${candidates}`);
  }

  throw new Error(`Not found: ${name}`);
}

async function getMdFileAsync(dir: string, name: string): Promise<string> {
  const fullDir = join(ROOT, dir);
  if (!existsSync(fullDir)) throw new Error(`Directory not found: ${dir}`);

  const normalizedName = toPosixPath(name).replace(/\.md$/, "");
  const directPath = join(fullDir, `${normalizedName}.md`);
  if (existsSync(directPath)) {
    return fsPromises.readFile(directPath, "utf-8");
  }

  const allFiles = findMdFilesRecursive(fullDir);
  const byBaseName = allFiles.filter((p) => basename(p, ".md") === normalizedName);
  if (byBaseName.length === 1) {
    return fsPromises.readFile(byBaseName[0], "utf-8");
  }
  if (byBaseName.length > 1) {
    const candidates = byBaseName
      .map((p) => toPosixPath(relative(fullDir, p)).replace(/\.md$/, ""))
      .join(", ");
    throw new Error(`Ambiguous name: ${name}. Use one of: ${candidates}`);
  }

  throw new Error(`Not found: ${name}`);
}

async function buildChatPrompt(
  topic: string,
  agentNames: string[],
  personaName: string | undefined,
  skillNames: string[],
  filePaths: string[],
  turns: number,
  maxContextChars?: number
): Promise<string> {
  const selectedAgents = agentNames.length > 0 ? agentNames : ["product-manager", "architect", "qa-engineer"];

  const totalItems = filePaths.length + selectedAgents.length + skillNames.length + (personaName ? 1 : 0);
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

  const turnInstruction = turns > 0
    ? `複数エージェントで議論し、最大 ${turns} ターンで回答してください。`
    : "単一回答として整理してください。";

  sections.push(`## タスク\n\nトピック: 「${topic}」\n\n${turnInstruction}\n\nルール:\n- 関連コードがある場合は根拠として参照する\n- 各エージェントの専門性と適用スキルに基づいて回答する\n- 不明点は推測を避け、必要な前提を明示する\n- 重要な設計判断や懸念点を簡潔に示す\n- ペルソナがある場合はその文体で回答する\n- 発言形式は必ず「**agent-name**: 発言内容」を使う（誰の発言か判別できる形にする）`);

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

type SystemEventName =
  | "session_start"
  | "turn_complete"
  | "tool_before_execute"
  | "tool_after_execute"
  | "preset_before_execute"
  | "governance_threshold_exceeded"
  | "low_relevance_detected"
  | "history_saved"
  | "error_aggregate_detected"
  | "session_end";

interface SystemEventRecord {
  id: string;
  event: SystemEventName;
  timestamp: string;
  payload: Record<string, unknown>;
}

const EVENT_DIR = join(ROOT, "outputs", "events");
const EVENT_LOG_FILE = join(EVENT_DIR, "system-events.jsonl");
const recentSystemEvents: SystemEventRecord[] = [];
const recentFailuresByTool = new Map<string, number[]>();
const errorAggregateLastEmitted = new Map<string, number>();
const ERROR_AGGREGATE_WINDOW_MS = 10 * 60 * 1000;
const ERROR_AGGREGATE_THRESHOLD = 3;
const ERROR_AGGREGATE_COOLDOWN_MS = 60 * 1000;
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

function summarizeValue(value: unknown, maxChars = 400): string {
  try {
    const raw = typeof value === "string" ? value : JSON.stringify(value);
    if (!raw) return "";
    return raw.length > maxChars ? raw.slice(0, maxChars) + "...(truncated)" : raw;
  } catch {
    return String(value);
  }
}

async function appendSystemEvent(record: SystemEventRecord): Promise<void> {
  await ensureDir(EVENT_DIR);
  await fsPromises.appendFile(EVENT_LOG_FILE, JSON.stringify(record) + "\n", "utf-8");
}

async function emitSystemEvent(event: SystemEventName, payload: Record<string, unknown>): Promise<void> {
  const resolvedPayload = { ...payload };
  await applyEventAutomation(event, resolvedPayload);

  const record: SystemEventRecord = {
    id: Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8),
    event,
    timestamp: new Date().toISOString(),
    payload: resolvedPayload
  };
  recentSystemEvents.push(record);
  if (recentSystemEvents.length > 200) {
    recentSystemEvents.splice(0, recentSystemEvents.length - 200);
  }
  try {
    await appendSystemEvent(record);
  } catch {
    // ignore event persistence failure
  }
}

async function registerToolFailure(toolName: string, error: unknown): Promise<void> {
  const now = Date.now();
  const bucket = recentFailuresByTool.get(toolName) ?? [];
  const fresh = bucket.filter((ts) => now - ts <= ERROR_AGGREGATE_WINDOW_MS);
  fresh.push(now);
  recentFailuresByTool.set(toolName, fresh);

  if (fresh.length >= ERROR_AGGREGATE_THRESHOLD) {
    const lastEmitted = errorAggregateLastEmitted.get(toolName) ?? 0;
    if (now - lastEmitted >= ERROR_AGGREGATE_COOLDOWN_MS) {
      errorAggregateLastEmitted.set(toolName, now);
      await emitSystemEvent("error_aggregate_detected", {
        toolName,
        failuresInWindow: fresh.length,
        windowMs: ERROR_AGGREGATE_WINDOW_MS,
        latestError: summarizeValue(error, 500)
      });
    }
  }
}

async function loadSystemEvents(limit = 50, event?: SystemEventName): Promise<SystemEventRecord[]> {
  const fromMemory = recentSystemEvents
    .filter((e) => (event ? e.event === event : true))
    .slice(-limit);

  if (fromMemory.length >= limit) {
    return fromMemory;
  }

  try {
    if (!existsSync(EVENT_LOG_FILE)) {
      return fromMemory;
    }
    const raw = await fsPromises.readFile(EVENT_LOG_FILE, "utf-8");
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);
    const parsed = lines
      .map((l) => {
        try {
          return JSON.parse(l) as SystemEventRecord;
        } catch {
          return null;
        }
      })
      .filter((x): x is SystemEventRecord => x !== null)
      .filter((e) => (event ? e.event === event : true));

    const merged = [...parsed, ...fromMemory];
    return merged.slice(-limit);
  } catch {
    return fromMemory;
  }
}

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

govTool(
  "repo_analyze",
  {
    title: "Repository Analyze",
    description: "Analyze a Salesforce repository and return key file inventories.",
    inputSchema: {
      path: z.string()
    }
  },
  async ({ path }) => {
    const result = analyzeRepo(path);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  }
);

govTool(
  "apex_analyze",
  {
    title: "Apex Analyze",
    description: "Run simple static checks for an Apex file.",
    inputSchema: {
      filePath: z.string()
    }
  },
  async ({ filePath }) => {
    const result = analyzeApex(filePath);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  }
);

govTool(
  "lwc_analyze",
  {
    title: "LWC Analyze",
    description: "Run simple static checks for an LWC JavaScript file.",
    inputSchema: {
      filePath: z.string()
    }
  },
  async ({ filePath }) => {
    const result = analyzeLwc(filePath);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  }
);

govTool(
  "deploy_org",
  {
    title: "Deploy Org",
    description: "Build deployment command for Salesforce org.",
    inputSchema: {
      targetOrg: z.string(),
      dryRun: z.boolean().optional()
    }
  },
  async ({ targetOrg, dryRun }) => {
    const result = buildDeployCommand(targetOrg, dryRun ?? true);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
    };
  }
);

govTool(
  "run_tests",
  {
    title: "Run Tests",
    description: "Build Apex test run command.",
    inputSchema: {
      targetOrg: z.string()
    }
  },
  async ({ targetOrg }) => {
    const command = buildTestCommand(targetOrg);
    return {
      content: [{ type: "text", text: command }]
    };
  }
);

govTool(
  "branch_diff_summary",
  {
    title: "Branch Diff Summary",
    description: "ベースブランチと作業ブランチの差分を要約します。",
    inputSchema: {
      repoPath: z.string(),
      baseBranch: z.string(),
      workingBranch: z.string(),
      maxFiles: z.number().int().min(1).max(200).optional()
    }
  },
  async ({ repoPath, baseBranch, workingBranch, maxFiles }) => {
    const result = summarizeBranchDiff({
      repoPath,
      integrationBranch: baseBranch,
      workingBranch,
      maxFiles: maxFiles ?? 20
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              comparison: baseBranch + "..." + workingBranch,
              filesChanged: result.filesChanged,
              added: result.added,
              modified: result.modified,
              deleted: result.deleted,
              renamed: result.renamed,
              copied: result.copied,
              fileTypeBreakdown: result.fileTypeBreakdown,
              summary: result.summary,
              fileChanges: result.fileChanges
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
  "branch_diff_to_prompt",
  {
    title: "Branch Diff To Prompt",
    description: "ブランチ差分からレビュー用プロンプトを生成します。",
    inputSchema: {
      repoPath: z.string(),
      baseBranch: z.string(),
      workingBranch: z.string(),
      topic: z.string().optional(),
      turns: z.number().int().min(1).max(30).optional(),
      maxHighlights: z.number().int().min(1).max(50).optional()
    }
  },
  async ({ repoPath, baseBranch, workingBranch, topic, turns, maxHighlights }) => {
    const result = buildBranchDiffPrompt({
      repoPath,
      integrationBranch: baseBranch,
      workingBranch,
      topic,
      turns,
      maxHighlights
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              comparison: baseBranch + "..." + workingBranch,
              recommendedAgents: result.recommendedAgents,
              summary: result.summary,
              prompt: result.prompt
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
  "list_agents",
  {
    title: "List Agents",
    description: "List all available AI agents with a short description each.",
    inputSchema: {}
  },
  async () => {
    const agents = listMdFiles("agents");
    return { content: [{ type: "text", text: JSON.stringify(agents, null, 2) }] };
  }
);

govTool(
  "get_agent",
  {
    title: "Get Agent Definition",
    description: "Return the full definition markdown for a specific agent by name.",
    inputSchema: { name: z.string() }
  },
  async ({ name }) => {
    const content = getMdFile("agents", name);
    return { content: [{ type: "text", text: content }] };
  }
);

govTool(
  "list_skills",
  {
    title: "List Skills",
    description: "List all available Salesforce skills with a short description each.",
    inputSchema: {}
  },
  async () => {
    const skills = listMdFiles("skills");
    return { content: [{ type: "text", text: JSON.stringify(skills, null, 2) }] };
  }
);

govTool(
  "get_skill",
  {
    title: "Get Skill Definition",
    description: "Return the full skill markdown for a specific skill by name.",
    inputSchema: { name: z.string() }
  },
  async ({ name }) => {
    const content = getMdFile("skills", name);
    return { content: [{ type: "text", text: content }] };
  }
);

govTool(
  "list_personas",
  {
    title: "List Personas",
    description: "List all available AI personas (personality/communication styles).",
    inputSchema: {}
  },
  async () => {
    const personas = listMdFiles("personas");
    return { content: [{ type: "text", text: JSON.stringify(personas, null, 2) }] };
  }
);

function normalizeForSearch(text: string): string {
  return text.toLowerCase().replace(/[\s_\-\/]+/g, " ").trim();
}

function tokenizeQuery(query: string): string[] {
  return normalizeForSearch(query)
    .split(" ")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

function scoreByQuery(query: string, ...targets: string[]): number {
  const normalizedQuery = normalizeForSearch(query);
  if (!normalizedQuery) return 0;

  const normalizedTargets = targets.map((t) => normalizeForSearch(t));
  let score = 0;

  for (const target of normalizedTargets) {
    if (!target) continue;
    if (target === normalizedQuery) score += 30;
    if (target.includes(normalizedQuery)) score += 12;
  }

  const tokens = tokenizeQuery(query);
  for (const token of tokens) {
    for (const target of normalizedTargets) {
      if (target.includes(token)) score += 4;
    }
  }

  return score;
}

async function suggestSkillsFromTopic(topic: string, limit = 3): Promise<string[]> {
  const skills = listMdFiles("skills");
  const ranked = skills
    .map((s) => ({
      name: s.name,
      score: scoreByQuery(topic, s.name, s.summary)
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.name);

  return ranked;
}

const chatInputSchema = {
  topic: z.string(),
  filePaths: z.array(z.string()).optional(),
  agents: z.array(z.string()).optional(),
  persona: z.string().optional(),
  skills: z.array(z.string()).optional(),
  turns: z.number().int().min(1).max(30).optional(),
  maxContextChars: z.number().int().min(500).max(200000).optional()
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
  maxContextChars
}: {
  topic: string;
  filePaths?: string[];
  agents?: string[];
  persona?: string;
  skills?: string[];
  turns?: number;
  maxContextChars?: number;
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
    maxContextChars
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

govTool(
  "chat",
  {
    title: "Chat (Default)",
    description: "デフォルトのマルチエージェントチャットを実行します。",
    inputSchema: chatInputSchema
  },
  runChatTool
);

govTool(
  "simulate_chat",
  {
    title: "Simulate Multi-Agent Chat (Compatibility Alias)",
    description: "chat の互換エイリアスです。",
    inputSchema: chatInputSchema
  },
  runChatTool
);

govTool(
  "orchestrate_chat",
  {
    title: "Orchestrate Chat (Pseudo Hook)",
    description: "疑似 hook によるオーケストレーション付きチャットを実行します。",
    inputSchema: {
      topic: z.string(),
      filePaths: z.array(z.string()).optional(),
      agents: z.array(z.string()).optional(),
      persona: z.string().optional(),
      skills: z.array(z.string()).optional(),
      turns: z.number().int().min(1).max(30).optional(),
      triggerRules: z.array(triggerRuleSchema).optional(),
      maxContextChars: z.number().int().min(500).max(200000).optional()
    }
  },
  async ({ topic, filePaths, agents, persona, skills, turns, triggerRules, maxContextChars }) => {
    const selectedAgents = agents ?? ["product-manager", "architect", "qa-engineer"];
    const sessionId = generateSessionId();
    const { enabled: enabledSkills, disabled: disabledSkills } = await filterDisabledSkills(skills ?? []);

    await emitSystemEvent("session_start", {
      sessionId,
      topic,
      agents: selectedAgents,
      triggerRuleCount: (triggerRules ?? []).length,
      requestedSkills: skills ?? [],
      enabledSkills,
      disabledSkills
    });

    const prompt = await buildChatPrompt(
      topic,
      selectedAgents,
      persona,
      enabledSkills,
      filePaths ?? [],
      turns ?? 6,
      maxContextChars
    );

    const session: OrchestrationSession = {
      id: sessionId,
      topic,
      agents: selectedAgents,
      persona,
      skills: enabledSkills,
      filePaths: filePaths ?? [],
      turns: turns ?? 6,
      triggerRules: triggerRules ?? [],
      queue: [...selectedAgents],
      history: [],
      firedRules: []
    };
    orchestrationSessions.set(sessionId, session);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              sessionId,
              mode: "pseudo-hook",
              nextQueue: session.queue,
              triggerRuleCount: session.triggerRules.length,
              disabledSkills,
              prompt
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
  "evaluate_triggers",
  {
    title: "Evaluate Triggers (Pseudo Hook)",
    description: "トリガールールを評価して次のエージェント候補を返します。",
    inputSchema: {
      sessionId: z.string().optional(),
      lastAgent: z.string(),
      lastMessage: z.string(),
      triggerRules: z.array(triggerRuleSchema).optional(),
      fallbackRoundRobin: z.boolean().optional()
    }
  },
  async ({ sessionId, lastAgent, lastMessage, triggerRules, fallbackRoundRobin }) => {
    let rules = triggerRules ?? [];
    let session: OrchestrationSession | undefined;
    let firedRules: string[] = [];
    let roundRobinNext: string | null = null;

    if (sessionId) {
      session = orchestrationSessions.get(sessionId);
      if (!session) {
        return {
          content: [{ type: "text", text: "Session not found: " + sessionId }]
        };
      }
      if (rules.length === 0) {
        rules = session.triggerRules;
      }
      firedRules = session.firedRules;
    }

    const hookResult = evaluatePseudoHooks(lastAgent, lastMessage, rules, firedRules);
    let nextAgents = [...hookResult.nextAgents];

    if (session && (fallbackRoundRobin ?? true) && nextAgents.length === 0 && session.agents.length > 0) {
      const idx = session.agents.indexOf(lastAgent);
      const nextIndex = idx >= 0 ? (idx + 1) % session.agents.length : 0;
      roundRobinNext = session.agents[nextIndex];
      nextAgents = [roundRobinNext];
    }

    if (session) {
      session.history.push({
        agent: lastAgent,
        message: lastMessage,
        timestamp: new Date().toISOString(),
        topic: session.topic
      });
      session.firedRules.push(...hookResult.fired);
      for (const nextAgent of nextAgents) {
        session.queue.push(nextAgent);
      }
    }

    await emitSystemEvent("turn_complete", {
      sessionId: sessionId ?? null,
      lastAgent,
      nextAgents,
      reasons: hookResult.reasons,
      usedRoundRobinFallback: roundRobinNext !== null,
      queueLength: session ? session.queue.length : null
    });

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              sessionId: sessionId ?? null,
              nextAgents,
              reasons: hookResult.reasons,
              usedRoundRobinFallback: roundRobinNext !== null,
              queueLength: session ? session.queue.length : null
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
  "dequeue_next_agent",
  {
    title: "Dequeue Next Agent",
    description: "オーケストレーションセッションの次エージェントを取り出します。",
    inputSchema: {
      sessionId: z.string(),
      limit: z.number().int().min(1).max(10).optional()
    }
  },
  async ({ sessionId, limit }) => {
    const session = orchestrationSessions.get(sessionId);
    if (!session) {
      return {
        content: [{ type: "text", text: "Session not found: " + sessionId }]
      };
    }

    const take = limit ?? 1;
    const nextAgents: string[] = [];
    for (let i = 0; i < take; i++) {
      const agent = session.queue.shift();
      if (!agent) {
        break;
      }
      nextAgents.push(agent);
    }

    if (session.queue.length === 0) {
      await emitSystemEvent("session_end", {
        sessionId,
        topic: session.topic,
        reason: "queue-empty",
        historyCount: session.history.length,
        firedRuleCount: session.firedRules.length
      });
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              sessionId,
              dequeued: nextAgents,
              remainingQueue: session.queue
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
  "get_orchestration_session",
  {
    title: "Get Orchestration Session",
    description: "オーケストレーションセッションの状態を返します。",
    inputSchema: {
      sessionId: z.string()
    }
  },
  async ({ sessionId }) => {
    const session = orchestrationSessions.get(sessionId);
    if (!session) {
      return {
        content: [{ type: "text", text: "Session not found: " + sessionId }]
      };
    }
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              id: session.id,
              topic: session.topic,
              agents: session.agents,
              queue: session.queue,
              triggerRules: session.triggerRules,
              historyCount: session.history.length,
              firedRuleCount: session.firedRules.length
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
  "record_agent_message",
  {
    title: "Record Agent Message",
    description: "エージェントメッセージを内部ログに記録します。",
    inputSchema: {
      agent: z.string(),
      message: z.string(),
      topic: z.string().optional()
    }
  },
  async ({ agent, message, topic }) => {
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
    description: "記録済みのエージェントログを返します。",
    inputSchema: {
      agent: z.string().optional(),
      limit: z.number().int().min(1).max(200).optional()
    }
  },
  async ({ agent, limit }) => {
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
    description: "チャットテキストを解析してエージェントログへ記録します。",
    inputSchema: {
      chatText: z.string(),
      topic: z.string().optional()
    }
  },
  async ({ chatText, topic }) => {
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

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              recorded: parsed.length,
              topic: topic ?? null,
              agents: uniqueAgents,
              totalLogCount: agentLog.length
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
    description: "内部イベントログを取得します。",
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
  async ({ limit, event }) => {
    const events = await loadSystemEvents(limit ?? 50, event);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            count: events.length,
            event: event ?? null,
            events
          }, null, 2)
        }
      ]
    };
  }
);

govTool(
  "get_event_automation_config",
  {
    title: "Get Event Automation Config",
    description: "イベント自動アクション設定を返します。",
    inputSchema: {}
  },
  async () => {
    const state = await loadGovernanceState();
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(state.config.eventAutomation, null, 2)
        }
      ]
    };
  }
);

govTool(
  "update_event_automation_config",
  {
    title: "Update Event Automation Config",
    description: "イベント自動アクション設定を更新します。",
    inputSchema: {
      enabled: z.boolean().optional(),
      protectedTools: z.array(z.string()).optional(),
      errorAggregateDetected: z.object({
        autoDisableTool: z.boolean().optional()
      }).optional(),
      governanceThresholdExceeded: z.object({
        autoDisableRecommendedTools: z.boolean().optional(),
        maxToolsPerRun: z.number().int().min(0).max(20).optional()
      }).optional()
    }
  },
  async ({ enabled, protectedTools, errorAggregateDetected, governanceThresholdExceeded }) => {
    const defaults = buildDefaultGovernanceState().config.eventAutomation;
    const state = await loadGovernanceState();
    state.config.eventAutomation = {
      ...defaults,
      ...state.config.eventAutomation,
      enabled: enabled ?? state.config.eventAutomation?.enabled ?? defaults.enabled,
      protectedTools: normalizeProtectedTools(protectedTools ?? state.config.eventAutomation?.protectedTools ?? defaults.protectedTools),
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
    await saveGovernanceState(state);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            updated: true,
            eventAutomation: state.config.eventAutomation
          }, null, 2)
        }
      ]
    };
  }
);

// ============================================================
// 永続化・プリセット・共有ヘルパー
// ============================================================

const HISTORY_DIR = join(ROOT, "outputs", "history");
const PRESETS_DIR = join(ROOT, "outputs", "presets");

async function ensureDir(dir: string): Promise<void> {
  if (!existsSync(dir)) {
    await fsPromises.mkdir(dir, { recursive: true });
  }
}

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

interface ChatPreset {
  name: string;
  description: string;
  topic: string;
  agents: string[];
  skills: string[];
  persona?: string;
  filePaths?: string[];
}

async function createPreset(preset: ChatPreset): Promise<void> {
  await ensureDir(PRESETS_DIR);
  const fileName = preset.name.toLowerCase().replace(/\s+/g, "-");
  const filePath = join(PRESETS_DIR, fileName + ".json");
  await fsPromises.writeFile(filePath, JSON.stringify(preset, null, 2));
}

async function listPresetsData(): Promise<ChatPreset[]> {
  if (!existsSync(PRESETS_DIR)) {
    return [];
  }
  
  const files = await fsPromises.readdir(PRESETS_DIR);
  const presets: ChatPreset[] = [];
  
  for (const file of files) {
    if (file.endsWith(".json")) {
      try {
        const content = await fsPromises.readFile(join(PRESETS_DIR, file), "utf-8");
        presets.push(JSON.parse(content));
      } catch {
        // skip
      }
    }
  }
  
  return presets;
}

async function getPreset(name: string): Promise<ChatPreset | null> {
  const presets = await listPresetsData();
  return presets.find((p) => p.name === name) ?? null;
}

// ============================================================
// Resource Governance（スキル・ツール・プリセット管理）
// ============================================================

type GovernedResourceType = "skills" | "tools" | "presets";
type GovernanceActionType = "create" | "delete" | "disable" | "enable";

interface GovernanceConfig {
  maxCounts: {
    skills: number;
    tools: number;
    presets: number;
  };
  thresholds: {
    minUsageToKeep: number;
    bugSignalToFlag: number;
  };
  eventAutomation: {
    enabled: boolean;
    protectedTools: string[];
    rules: {
      errorAggregateDetected: {
        autoDisableTool: boolean;
      };
      governanceThresholdExceeded: {
        autoDisableRecommendedTools: boolean;
        maxToolsPerRun: number;
      };
    };
  };
}

interface GovernanceState {
  config: GovernanceConfig;
  usage: Record<GovernedResourceType, Record<string, number>>;
  bugSignals: Record<GovernedResourceType, Record<string, number>>;
  disabled: Record<GovernedResourceType, string[]>;
  updatedAt: string;
}

const GOVERNANCE_FILE = join(ROOT, "outputs", "resource-governance.json");
const TOOL_PROPOSALS_DIR = join(ROOT, "outputs", "tool-proposals");
const CUSTOM_TOOLS_DIR = join(ROOT, "outputs", "custom-tools");

// カスタムツール定義（apply_resource_actions で作成されるツール）
interface CustomToolDefinition {
  name: string;
  description: string;
  agents: string[];
  skills: string[];
  persona?: string;
  createdAt: string;
}

// 登録済みカスタムツール名を追跡
const loadedCustomToolNames: Set<string> = new Set();

function registerCustomTool(def: CustomToolDefinition): void {
  if (loadedCustomToolNames.has(def.name)) return; // 二重登録防止
  loadedCustomToolNames.add(def.name);
  govTool(
    def.name,
    {
      title: def.name,
      description: def.description,
      inputSchema: {
        topic: z.string().optional(),
        maxContextChars: z.number().int().min(500).max(200000).optional()
      }
    },
    async ({ topic, maxContextChars }: { topic?: string; maxContextChars?: number }) => {
      const { enabled: enabledSkills } = await filterDisabledSkills(def.skills ?? []);
      const prompt = await buildChatPrompt(
        topic ?? def.name,
        def.agents,
        def.persona,
        enabledSkills,
        [],
        6,
        maxContextChars
      );
      return { content: [{ type: "text", text: prompt }] };
    }
  );
}

async function loadAndRegisterCustomTools(): Promise<void> {
  if (!existsSync(CUSTOM_TOOLS_DIR)) return;
  let files: string[];
  try {
    files = await fsPromises.readdir(CUSTOM_TOOLS_DIR);
  } catch {
    return;
  }
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    try {
      const raw = await fsPromises.readFile(join(CUSTOM_TOOLS_DIR, file), "utf-8");
      const def = JSON.parse(raw) as CustomToolDefinition;
      registerCustomTool(def);
    } catch {
      // 壊れたファイルはスキップ
    }
  }
}

const BUILTIN_TOOL_CATALOG = [
  "repo_analyze",
  "apex_analyze",
  "lwc_analyze",
  "deploy_org",
  "run_tests",
  "branch_diff_summary",
  "branch_diff_to_prompt",
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
  "export_to_markdown",
  "batch_chat"
];

function buildDefaultGovernanceState(): GovernanceState {
  return {
    config: {
      maxCounts: {
        skills: 30,
        tools: 40,
        presets: 20
      },
      thresholds: {
        minUsageToKeep: 2,
        bugSignalToFlag: 2
      },
      eventAutomation: {
        enabled: true,
        protectedTools: [...DEFAULT_PROTECTED_TOOLS],
        rules: {
          errorAggregateDetected: {
            autoDisableTool: true
          },
          governanceThresholdExceeded: {
            autoDisableRecommendedTools: false,
            maxToolsPerRun: 3
          }
        }
      }
    },
    usage: {
      skills: {},
      tools: {},
      presets: {}
    },
    bugSignals: {
      skills: {},
      tools: {},
      presets: {}
    },
    disabled: {
      skills: [],
      tools: [],
      presets: []
    },
    updatedAt: new Date().toISOString()
  };
}

async function loadGovernanceState(): Promise<GovernanceState> {
  await ensureDir(join(ROOT, "outputs"));

  if (!existsSync(GOVERNANCE_FILE)) {
    const initial = buildDefaultGovernanceState();
    await fsPromises.writeFile(GOVERNANCE_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }

  try {
    const raw = await fsPromises.readFile(GOVERNANCE_FILE, "utf-8");
    const parsed = JSON.parse(raw) as GovernanceState;
    return {
      ...buildDefaultGovernanceState(),
      ...parsed,
      config: {
        ...buildDefaultGovernanceState().config,
        ...parsed.config,
        maxCounts: {
          ...buildDefaultGovernanceState().config.maxCounts,
          ...parsed.config?.maxCounts
        },
        thresholds: {
          ...buildDefaultGovernanceState().config.thresholds,
          ...parsed.config?.thresholds
        },
        eventAutomation: {
          ...buildDefaultGovernanceState().config.eventAutomation,
          ...parsed.config?.eventAutomation,
          protectedTools: normalizeProtectedTools(
            parsed.config?.eventAutomation?.protectedTools ?? buildDefaultGovernanceState().config.eventAutomation.protectedTools
          ),
          rules: {
            ...buildDefaultGovernanceState().config.eventAutomation.rules,
            ...parsed.config?.eventAutomation?.rules,
            errorAggregateDetected: {
              ...buildDefaultGovernanceState().config.eventAutomation.rules.errorAggregateDetected,
              ...parsed.config?.eventAutomation?.rules?.errorAggregateDetected
            },
            governanceThresholdExceeded: {
              ...buildDefaultGovernanceState().config.eventAutomation.rules.governanceThresholdExceeded,
              ...parsed.config?.eventAutomation?.rules?.governanceThresholdExceeded
            }
          }
        }
      },
      usage: {
        ...buildDefaultGovernanceState().usage,
        ...parsed.usage
      },
      bugSignals: {
        ...buildDefaultGovernanceState().bugSignals,
        ...parsed.bugSignals
      },
      disabled: {
        ...buildDefaultGovernanceState().disabled,
        ...parsed.disabled
      }
    };
  } catch {
    const initial = buildDefaultGovernanceState();
    await fsPromises.writeFile(GOVERNANCE_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
}

async function saveGovernanceState(state: GovernanceState): Promise<void> {
  state.updatedAt = new Date().toISOString();
  await fsPromises.writeFile(GOVERNANCE_FILE, JSON.stringify(state, null, 2));
}

function normalizeDisabledEntries(names: string[]): string[] {
  return [...new Set(names.map((name) => name.trim()).filter((name) => name.length > 0))].sort();
}

function normalizeProtectedTools(names: string[]): string[] {
  return normalizeDisabledEntries([...DEFAULT_PROTECTED_TOOLS, ...names]);
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

async function listSkillsCatalog(): Promise<string[]> {
  const fullDir = join(ROOT, "skills");
  const files = findMdFilesRecursive(fullDir);
  return files
    .map((f) => toPosixPath(relative(fullDir, f)).replace(/\.md$/, ""))
    .sort();
}

async function listPresetsCatalog(): Promise<string[]> {
  const presets = await listPresetsData();
  return presets.map((p) => p.name).sort();
}

function listToolsCatalog(state: GovernanceState): string[] {
  return [...new Set([
    ...BUILTIN_TOOL_CATALOG,
    ...loadedCustomToolNames,
    ...Object.keys(state.usage.tools)
  ])].sort();
}

function resourceScore(usage: number, bugs: number): number {
  return usage - bugs * 3;
}

async function getCatalogCounts(state: GovernanceState): Promise<Record<GovernedResourceType, number>> {
  const skills = await listSkillsCatalog();
  const presets = await listPresetsCatalog();
  const tools = listToolsCatalog(state);
  return {
    skills: skills.length,
    tools: tools.length,
    presets: presets.length
  };
}

// ============================================================
// 永続化ツール
// ============================================================

govTool(
  "save_chat_history",
  {
    title: "Save Chat History",
    description: "現在のエージェントログを JSON 履歴として保存します。",
    inputSchema: {
      topic: z.string()
    }
  },
  async ({ topic }) => {
    const id = await saveChatHistory(topic);
    const messageCount = agentLog.filter((e) => e.topic === topic || !e.topic).length;
    await emitSystemEvent("history_saved", {
      historyId: id,
      topic,
      messageCount,
      path: "outputs/history/" + id + ".json"
    });
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { saved: true, id, path: "outputs/history/" + id + ".json" },
            null,
            2
          )
        }
      ]
    };
  }
);

govTool(
  "search_resources",
  {
    title: "Search Resources",
    description: "スキル・ツール・プリセットを横断検索し、関連度スコア付きで返します。",
    inputSchema: {
      query: z.string(),
      resourceTypes: z.array(z.enum(["skills", "tools", "presets"])).optional(),
      limitPerType: z.number().int().min(1).max(20).optional()
    }
  },
  async ({ query, resourceTypes, limitPerType }) => {
    const types = resourceTypes ?? ["skills", "tools", "presets"];
    const limit = limitPerType ?? 5;
    const state = await loadGovernanceState();

    const skillRows = types.includes("skills")
      ? listMdFiles("skills")
        .map((s) => ({
          name: s.name,
          summary: s.summary,
          score: scoreByQuery(query, s.name, s.summary),
          disabled: state.disabled.skills.includes(s.name)
        }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
      : [];

    const toolRows = types.includes("tools")
      ? [...registeredToolMetadata.entries()]
        .map(([name, meta]) => ({
          name,
          title: meta.title ?? name,
          description: meta.description ?? "",
          score: scoreByQuery(query, name, meta.title ?? "", meta.description ?? ""),
          disabled: state.disabled.tools.includes(name)
        }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
      : [];

    const presetRows = types.includes("presets")
      ? (await listPresetsData())
        .map((p) => ({
          name: p.name,
          description: p.description,
          topic: p.topic,
          agents: p.agents,
          score: scoreByQuery(query, p.name, p.description, p.topic, p.agents.join(" ")),
          disabled: state.disabled.presets.includes(p.name)
        }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
      : [];

    const maxSkillScore = skillRows[0]?.score ?? 0;
    const maxToolScore = toolRows[0]?.score ?? 0;
    const maxPresetScore = presetRows[0]?.score ?? 0;
    const overallMax = Math.max(maxSkillScore, maxToolScore, maxPresetScore);
    if (overallMax < LOW_RELEVANCE_SCORE_THRESHOLD) {
      await emitSystemEvent("low_relevance_detected", {
        source: "search_resources",
        query,
        maxSkillScore,
        maxToolScore,
        maxPresetScore,
        threshold: LOW_RELEVANCE_SCORE_THRESHOLD
      });
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              query,
              resourceTypes: types,
              skills: skillRows,
              tools: toolRows,
              presets: presetRows
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
  "auto_select_resources",
  {
    title: "Auto Select Resources",
    description: "トピックから最適なスキル・ツール・プリセット候補を自動選択します。",
    inputSchema: {
      topic: z.string(),
      limitPerType: z.number().int().min(1).max(10).optional()
    }
  },
  async ({ topic, limitPerType }) => {
    const limit = limitPerType ?? 3;
    const state = await loadGovernanceState();

    const rankedSkills = listMdFiles("skills")
      .map((s) => ({
        name: s.name,
        score: scoreByQuery(topic, s.name, s.summary),
        disabled: state.disabled.skills.includes(s.name)
      }))
      .filter((x) => x.score > 0 && !x.disabled)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    const rankedTools = [...registeredToolMetadata.entries()]
      .map(([name, meta]) => ({
        name,
        title: meta.title ?? name,
        score: scoreByQuery(topic, name, meta.title ?? "", meta.description ?? ""),
        disabled: state.disabled.tools.includes(name)
      }))
      .filter((x) => x.score > 0 && !x.disabled)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    const rankedPresets = (await listPresetsData())
      .map((p) => ({
        name: p.name,
        topic: p.topic,
        description: p.description,
        agents: p.agents,
        score: scoreByQuery(topic, p.name, p.topic, p.description, p.agents.join(" ")),
        disabled: state.disabled.presets.includes(p.name)
      }))
      .filter((x) => x.score > 0 && !x.disabled)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    const overallMax = Math.max(
      rankedSkills[0]?.score ?? 0,
      rankedTools[0]?.score ?? 0,
      rankedPresets[0]?.score ?? 0
    );
    if (overallMax < LOW_RELEVANCE_SCORE_THRESHOLD) {
      await emitSystemEvent("low_relevance_detected", {
        source: "auto_select_resources",
        topic,
        maxScore: overallMax,
        threshold: LOW_RELEVANCE_SCORE_THRESHOLD
      });
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              topic,
              selected: {
                skills: rankedSkills.map((x) => x.name),
                tools: rankedTools.map((x) => x.name),
                presets: rankedPresets.map((x) => x.name)
              },
              detail: {
                skills: rankedSkills,
                tools: rankedTools,
                presets: rankedPresets
              },
              note: "上位候補を返します。エージェントはこの結果を見て適切なツール呼び出しを続けてください。"
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
  "load_chat_history",
  {
    title: "Load Chat History",
    description: "保存済みチャット履歴の一覧を返します。",
    inputSchema: {}
  },
  async () => {
    const sessions = await loadChatHistories();
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            sessions.map((s) => ({
              id: s.id,
              timestamp: s.timestamp,
              topic: s.topic,
              agents: s.agents,
              messageCount: s.entries.length
            })),
            null,
            2
          )
        }
      ]
    };
  }
);

govTool(
  "restore_chat_history",
  {
    title: "Restore Chat History",
    description: "保存済みチャット履歴をメモリへ復元します。",
    inputSchema: {
      id: z.string()
    }
  },
  async ({ id }) => {
    const session = await restoreChatHistory(id);
    if (!session) {
      return {
        content: [{ type: "text", text: "History not found: " + id }]
      };
    }
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              restored: true,
              topic: session.topic,
              agents: session.agents,
              messages: session.entries.length
            },
            null,
            2
          )
        }
      ]
    };
  }
);

// ============================================================
// プリセットツール
// ============================================================

govTool(
  "create_preset",
  {
    title: "Create Chat Preset",
    description: "チャットプリセットを作成します。",
    inputSchema: {
      name: z.string(),
      description: z.string(),
      topic: z.string(),
      agents: z.array(z.string()),
      skills: z.array(z.string()).optional(),
      persona: z.string().optional(),
      filePaths: z.array(z.string()).optional()
    }
  },
  async ({ name, description, topic, agents, skills, persona, filePaths }) => {
    await createPreset({
      name,
      description,
      topic,
      agents,
      skills: skills ?? [],
      persona,
      filePaths
    });
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              created: true,
              name,
              path: "outputs/presets/" + name.toLowerCase().replace(/\s+/g, "-") + ".json"
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
  "list_presets",
  {
    title: "List Chat Presets",
    description: "チャットプリセット一覧を返します。",
    inputSchema: {}
  },
  async () => {
    const presets = await listPresetsData();
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            presets.map((p) => ({
              name: p.name,
              description: p.description,
              agents: p.agents
            })),
            null,
            2
          )
        }
      ]
    };
  }
);

govTool(
  "run_preset",
  {
    title: "Run Chat Preset",
    description: "プリセット設定を使って chat を実行します。",
    inputSchema: {
      name: z.string(),
      overrideTopic: z.string().optional(),
      maxContextChars: z.number().int().min(500).max(200000).optional()
    }
  },
  async ({ name, overrideTopic, maxContextChars }) => {
    await emitSystemEvent("preset_before_execute", {
      presetName: name,
      overrideTopic: overrideTopic ?? null
    });

    if (await isPresetDisabled(name)) {
      return {
        content: [{ type: "text", text: "Preset is disabled: " + name }]
      };
    }

    const preset = await getPreset(name);
    if (!preset) {
      return {
        content: [{ type: "text", text: "Preset not found: " + name }]
      };
    }

    const { enabled: enabledSkills } = await filterDisabledSkills(preset.skills ?? []);
    const topic = overrideTopic ?? preset.topic;
    const prompt = await buildChatPrompt(
      topic,
      preset.agents,
      preset.persona,
      enabledSkills,
      preset.filePaths ?? [],
      6,
      maxContextChars
    );

    return {
      content: [
        {
          type: "text",
          text: prompt
        }
      ]
    };
  }
);

govTool(
  "get_resource_governance",
  {
    title: "Get Resource Governance",
    description: "リソース管理状態を返します。",
    inputSchema: {}
  },
  async () => {
    const state = await loadGovernanceState();
    const counts = await getCatalogCounts(state);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            updatedAt: state.updatedAt,
            config: state.config,
            eventAutomation: state.config.eventAutomation,
            counts,
            disabled: state.disabled,
            usage: state.usage,
            bugSignals: state.bugSignals
          }, null, 2)
        }
      ]
    };
  }
);

govTool(
  "record_resource_signal",
  {
    title: "Record Resource Signal",
    description: "リソースの usage と bug signal を記録します。",
    inputSchema: {
      resourceType: z.enum(["skills", "tools", "presets"]),
      name: z.string(),
      usageIncrement: z.number().int().min(0).max(100).optional(),
      bugIncrement: z.number().int().min(0).max(100).optional()
    }
  },
  async ({ resourceType, name, usageIncrement, bugIncrement }) => {
    const state = await loadGovernanceState();
    state.usage[resourceType][name] = (state.usage[resourceType][name] ?? 0) + (usageIncrement ?? 1);
    state.bugSignals[resourceType][name] = (state.bugSignals[resourceType][name] ?? 0) + (bugIncrement ?? 0);
    await saveGovernanceState(state);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            saved: true,
            resourceType,
            name,
            usage: state.usage[resourceType][name],
            bugSignals: state.bugSignals[resourceType][name]
          }, null, 2)
        }
      ]
    };
  }
);

govTool(
  "review_resource_governance",
  {
    title: "Review Resource Governance",
    description: "リソース管理状態をレビューして推奨アクションを返します。",
    inputSchema: {
      updateMaxCounts: z.object({
        skills: z.number().int().min(1).max(200).optional(),
        tools: z.number().int().min(1).max(200).optional(),
        presets: z.number().int().min(1).max(200).optional()
      }).optional(),
      updateThresholds: z.object({
        minUsageToKeep: z.number().int().min(0).max(100).optional(),
        bugSignalToFlag: z.number().int().min(0).max(100).optional()
      }).optional()
    }
  },
  async ({ updateMaxCounts, updateThresholds }) => {
    const state = await loadGovernanceState();
    if (updateMaxCounts) {
      state.config.maxCounts = {
        ...state.config.maxCounts,
        ...updateMaxCounts
      };
    }
    if (updateThresholds) {
      state.config.thresholds = {
        ...state.config.thresholds,
        ...updateThresholds
      };
    }
    await saveGovernanceState(state);

    const counts = await getCatalogCounts(state);
    const recommendations: Array<{
      resourceType: GovernedResourceType;
      action: GovernanceActionType;
      name: string;
      reason: string;
      usage: number;
      bugSignals: number;
      score: number;
    }> = [];

    const catalogs: Record<GovernedResourceType, string[]> = {
      skills: await listSkillsCatalog(),
      tools: listToolsCatalog(state),
      presets: await listPresetsCatalog()
    };

    for (const resourceType of ["skills", "tools", "presets"] as const) {
      const catalog = catalogs[resourceType];
      const max = state.config.maxCounts[resourceType];
      const overflow = Math.max(0, catalog.length - max);

      const sortedByRisk = [...catalog].sort((a, b) => {
        const scoreA = resourceScore(state.usage[resourceType][a] ?? 0, state.bugSignals[resourceType][a] ?? 0);
        const scoreB = resourceScore(state.usage[resourceType][b] ?? 0, state.bugSignals[resourceType][b] ?? 0);
        return scoreA - scoreB;
      });

      for (let i = 0; i < overflow; i++) {
        const name = sortedByRisk[i];
        const usage = state.usage[resourceType][name] ?? 0;
        const bugSignals = state.bugSignals[resourceType][name] ?? 0;
        recommendations.push({
          resourceType,
          action: resourceType === "tools" ? "disable" : "delete",
          name,
          reason: "上限超過（" + catalog.length + "/" + max + "）のため整理候補",
          usage,
          bugSignals,
          score: resourceScore(usage, bugSignals)
        });
      }

      for (const name of catalog) {
        const usage = state.usage[resourceType][name] ?? 0;
        const bugSignals = state.bugSignals[resourceType][name] ?? 0;
        if (usage <= state.config.thresholds.minUsageToKeep && bugSignals >= state.config.thresholds.bugSignalToFlag) {
          recommendations.push({
            resourceType,
            action: resourceType === "tools" ? "disable" : "delete",
            name,
            reason: "低利用（" + usage + "）かつバグ兆候高（" + bugSignals + "）",
            usage,
            bugSignals,
            score: resourceScore(usage, bugSignals)
          });
        }
      }
    }

    if (recommendations.length > 0) {
      await emitSystemEvent("governance_threshold_exceeded", {
        counts,
        thresholds: state.config.thresholds,
        recommendations: recommendations.slice(0, 20),
        recommendationCount: recommendations.length
      });
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            counts,
            maxCounts: state.config.maxCounts,
            thresholds: state.config.thresholds,
            recommendations
          }, null, 2)
        }
      ]
    };
  }
);

govTool(
  "apply_resource_actions",
  {
    title: "Apply Resource Actions",
    description: "リソース管理アクションを実行します。",
    inputSchema: {
      actions: z.array(z.object({
        resourceType: z.enum(["skills", "tools", "presets"]),
        action: z.enum(["create", "delete", "disable", "enable"]),
        name: z.string(),
        content: z.string().optional(),
        preset: z.object({
          name: z.string(),
          description: z.string(),
          topic: z.string(),
          agents: z.array(z.string()),
          skills: z.array(z.string()).optional(),
          persona: z.string().optional(),
          filePaths: z.array(z.string()).optional()
        }).optional()
      })).min(1).max(50)
    }
  },
  async ({ actions }) => {
    const state = await loadGovernanceState();
    await ensureDir(PRESETS_DIR);
    await ensureDir(join(ROOT, "skills"));
    await ensureDir(TOOL_PROPOSALS_DIR);

    const results: Array<{ action: string; resourceType: string; name: string; result: string }> = [];

    for (const item of actions) {
      const { resourceType, action, name, content, preset } = item;

      if (action === "disable") {
        if (!state.disabled[resourceType].includes(name)) {
          state.disabled[resourceType].push(name);
        }
        results.push({ action, resourceType, name, result: "disabled" });
        continue;
      }

      if (action === "enable") {
        state.disabled[resourceType] = state.disabled[resourceType].filter((x) => x !== name);
        results.push({ action, resourceType, name, result: "enabled" });
        continue;
      }

      if (resourceType === "skills") {
        const skillPath = join(ROOT, "skills", toPosixPath(name).replace(/\.md$/, "") + ".md");
        if (action === "create") {
          const count = (await listSkillsCatalog()).length;
          if (count >= state.config.maxCounts.skills) {
            results.push({ action, resourceType, name, result: "max reached (" + count + ")" });
            continue;
          }
          
          // 品質チェック（Phase 3 強化）
          const contentToWrite = content ?? ("# " + name + "\n\n(ここにスキル内容を記述)");
          const qualityValidation = await validateAndCreateSkillWithQuality(name, contentToWrite, state);
          
          if (!qualityValidation.success) {
            results.push({ action, resourceType, name, result: "quality_check_failed: " + qualityValidation.message });
            // イベント発火
            try {
              await emitEvent({
                type: "quality_check_failed",
                timestamp: new Date().toISOString(),
                payload: {
                  resourceType: "skills",
                  name,
                  errors: [qualityValidation.message]
                }
              });
            } catch (e) {
              // ignore
            }
            continue;
          }
          
          await ensureDir(dirname(skillPath));
          await fsPromises.writeFile(skillPath, contentToWrite);
          results.push({ action, resourceType, name, result: "created (quality_score: " + (qualityValidation.qualityScore ?? 0) + ")" });
          
          // リソース作成イベント発火
          try {
            await emitEvent({
              type: "resource_created",
              timestamp: new Date().toISOString(),
              payload: {
                resourceType: "skills",
                name,
                source: "apply_resource_actions"
              }
            });
          } catch (e) {
            // ignore
          }
          continue;
        }
        if (action === "delete") {
          if (existsSync(skillPath)) {
            await fsPromises.unlink(skillPath);
            results.push({ action, resourceType, name, result: "deleted" });
          } else {
            results.push({ action, resourceType, name, result: "not-found" });
          }
          continue;
        }
      }

      if (resourceType === "presets") {
        const fileName = name.toLowerCase().replace(/\s+/g, "-");
        const presetPath = join(PRESETS_DIR, fileName + ".json");
        if (action === "create") {
          const count = (await listPresetsCatalog()).length;
          if (count >= state.config.maxCounts.presets) {
            results.push({ action, resourceType, name, result: "max reached (" + count + ")" });
            continue;
          }
          
          // プリセット準備
          let presetToCreate: ChatPreset;
          if (preset) {
            presetToCreate = {
              ...preset,
              skills: preset.skills ?? []
            };
          } else {
            presetToCreate = {
              name,
              description: "自動作成プリセット",
              topic: name,
              agents: ["product-manager", "architect", "qa-engineer"],
              skills: []
            };
          }
          
          // 品質チェック（Phase 3 強化）
          const qualityValidation = await validateAndCreatePresetWithQuality(
            name,
            {
              description: presetToCreate.description,
              agents: presetToCreate.agents,
              topic: presetToCreate.topic
            },
            state
          );
          
          if (!qualityValidation.success) {
            results.push({ action, resourceType, name, result: "quality_check_failed: " + qualityValidation.message });
            // イベント発火
            try {
              await emitEvent({
                type: "quality_check_failed",
                timestamp: new Date().toISOString(),
                payload: {
                  resourceType: "presets",
                  name,
                  errors: [qualityValidation.message]
                }
              });
            } catch (e) {
              // ignore
            }
            continue;
          }
          
          await createPreset(presetToCreate);
          results.push({ action, resourceType, name, result: "created (quality_score: " + (qualityValidation.qualityScore ?? 0) + ")" });
          
          // リソース作成イベント発火
          try {
            await emitEvent({
              type: "resource_created",
              timestamp: new Date().toISOString(),
              payload: {
                resourceType: "presets",
                name,
                source: "apply_resource_actions"
              }
            });
          } catch (e) {
            // ignore
          }
          continue;
        }
        if (action === "delete") {
          if (existsSync(presetPath)) {
            await fsPromises.unlink(presetPath);
            results.push({ action, resourceType, name, result: "deleted" });
          } else {
            results.push({ action, resourceType, name, result: "not-found" });
          }
          continue;
        }
      }

      if (resourceType === "tools") {
        if (action === "create") {
          const count = listToolsCatalog(state).length;
          if (count >= state.config.maxCounts.tools) {
            results.push({ action, resourceType, name, result: "max reached (" + count + ")" });
            continue;
          }
          
          const toolDescription = content ?? ("カスタムツール: " + name);
          
          // 品質チェック（Phase 3 強化）
          const qualityValidation = await validateAndCreateToolWithQuality(name, toolDescription, state);
          
          if (!qualityValidation.success) {
            results.push({ action, resourceType, name, result: "quality_check_failed: " + qualityValidation.message });
            // イベント発火
            try {
              await emitEvent({
                type: "quality_check_failed",
                timestamp: new Date().toISOString(),
                payload: {
                  resourceType: "tools",
                  name,
                  errors: [qualityValidation.message]
                }
              });
            } catch (e) {
              // ignore
            }
            continue;
          }
          
          await ensureDir(CUSTOM_TOOLS_DIR);
          const toolDef: CustomToolDefinition = {
            name,
            description: toolDescription,
            agents: ["product-manager", "architect"],
            skills: [],
            createdAt: new Date().toISOString()
          };
          const toolFileName = name.toLowerCase().replace(/\s+/g, "-");
          const toolPath = join(CUSTOM_TOOLS_DIR, toolFileName + ".json");
          await fsPromises.writeFile(toolPath, JSON.stringify(toolDef, null, 2));
          registerCustomTool(toolDef);
          results.push({ action, resourceType, name, result: "created (quality_score: " + (qualityValidation.qualityScore ?? 0) + "): " + toPosixPath(relative(ROOT, toolPath)) });
          
          // リソース作成イベント発火
          try {
            await emitEvent({
              type: "resource_created",
              timestamp: new Date().toISOString(),
              payload: {
                resourceType: "tools",
                name,
                source: "apply_resource_actions"
              }
            });
          } catch (e) {
            // ignore
          }
          continue;
        }
        if (action === "delete") {
          const toolFileName = name.toLowerCase().replace(/\s+/g, "-");
          const customToolPath = join(CUSTOM_TOOLS_DIR, toolFileName + ".json");
          if (existsSync(customToolPath)) {
            await fsPromises.unlink(customToolPath);
            loadedCustomToolNames.delete(name);
            results.push({ action, resourceType, name, result: "deleted (カスタムツールファイルを削除)" });
          } else {
            // ビルトインツールは disable のみ可能
            if (!state.disabled.tools.includes(name)) {
              state.disabled.tools.push(name);
            }
            results.push({ action, resourceType, name, result: "disabled (ビルトインツールはファイル削除不可)" });
          }
          continue;
        }
      }

      results.push({ action, resourceType, name, result: "unsupported" });
    }

    await saveGovernanceState(state);
    await refreshDisabledToolsCache();
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            applied: results.length,
            results,
            governanceFile: toPosixPath(relative(ROOT, GOVERNANCE_FILE))
          }, null, 2)
        }
      ]
    };
  }
);

// ============================================================
// スマート自動コンテキストツール
// ============================================================

govTool(
  "smart_chat",
  {
    title: "Smart Chat",
    description: "関連ファイルを自動検出して chat を実行します。",
    inputSchema: {
      topic: z.string(),
      agents: z.array(z.string()).optional(),
      persona: z.string().optional(),
      skills: z.array(z.string()).optional(),
      repoPath: z.string().optional(),
      maxContextChars: z.number().int().min(500).max(200000).optional()
    }
  },
  async ({ topic, agents, persona, skills, repoPath, maxContextChars }) => {
    // リポジトリ分析して関連ファイルを自動検出
    const targetPath = repoPath ?? ROOT;
    let autoFilePaths: string[] = [];
    const { enabled: enabledSkills } = await filterDisabledSkills(skills ?? []);

    try {
      const repoAnalysis = analyzeRepo(targetPath);
      // apex, lwc, data-model からサンプルを抽出（各1ファイル）
      const candidates = [
        ...(repoAnalysis.apex?.slice(0, 1) ?? []),
        ...(repoAnalysis.lwc?.slice(0, 1) ?? []),
        ...(repoAnalysis.objects?.slice(0, 1) ?? [])
      ];
      autoFilePaths = candidates.filter((p) => p && existsSync(p));
    } catch {
      // repo_analyze 失敗時は空配列で続行
    }

    const prompt = await buildChatPrompt(
      topic,
      agents ?? ["product-manager", "architect", "qa-engineer"],
      persona,
      enabledSkills,
      autoFilePaths,
      6,
      maxContextChars
    );

    return {
      content: [
        {
          type: "text",
          text: "【自動検出ファイル】\n" + (autoFilePaths.length > 0 ? autoFilePaths.join("\n") : "(なし)") + "\n\n" + prompt
        }
      ]
    };
  }
);

// ============================================================
// 統計・分析ツール
// ============================================================

govTool(
  "analyze_chat_trends",
  {
    title: "Analyze Chat Trends",
    description: "エージェントログの傾向を分析します。",
    inputSchema: {}
  },
  async () => {
    const stats: {
      [agent: string]: { count: number; avgLength: number; topics: string[] };
    } = {};

    for (const entry of agentLog) {
      if (!stats[entry.agent]) {
        stats[entry.agent] = {
          count: 0,
          avgLength: 0,
          topics: []
        };
      }
      stats[entry.agent].count++;
      stats[entry.agent].avgLength +=
        entry.message.length / stats[entry.agent].count;
      if (entry.topic && !stats[entry.agent].topics.includes(entry.topic)) {
        stats[entry.agent].topics.push(entry.topic);
      }
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              totalMessages: agentLog.length,
              uniqueAgents: Object.keys(stats).length,
              stats
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
  "export_to_markdown",
  {
    title: "Export Chat to Markdown",
    description: "チャット履歴を Markdown 形式でエクスポートします。",
    inputSchema: {
      historyId: z.string().optional(),
      title: z.string().optional()
    }
  },
  async ({ historyId, title }) => {
    const sessions = await loadChatHistories();
    let targetSession: ChatSession | undefined;

    if (historyId) {
      targetSession = sessions.find((s) => s.id === historyId);
    } else if (agentLog.length > 0) {
      // 現在のログから最新セッション相当を生成
      targetSession = {
        id: "current",
        timestamp: new Date().toISOString(),
        topic: agentLog[0]?.topic ?? "Untitled",
        agents: [...new Set(agentLog.map((e) => e.agent))],
        entries: agentLog
      };
    }

    if (!targetSession) {
      return {
        content: [{ type: "text", text: "Export target session not found." }]
      };
    }

    const markdown =
      "# " + (title ?? targetSession.topic) + "\n\n" +
      "**生成日時**: " + targetSession.timestamp + "  \n" +
      "**参加エージェント**: " + targetSession.agents.join(", ") + "  \n" +
      "**メッセージ数**: " + targetSession.entries.length + "\n\n" +
      "---\n\n" +
      "## 会話内容\n\n" +
      targetSession.entries.map((e) => "### " + e.agent + "\n\n" + e.message + "\n").join("\n---\n\n") +
      "\n\n---\n\n" +
      "Salesforce AI Company MCP exported markdown.";

    return {
      content: [
        {
          type: "text",
          text: markdown
        }
      ]
    };
  }
);

// ============================================================
// バッチ処理ツール
// ============================================================

govTool(
  "batch_chat",
  {
    title: "Batch Chat",
    description: "複数トピックを順次処理して統合レポートを返します。",
    inputSchema: {
      topics: z.array(z.string()).min(1).max(10),
      agents: z.array(z.string()).optional(),
      persona: z.string().optional(),
      skills: z.array(z.string()).optional(),
      maxContextChars: z.number().int().min(500).max(200000).optional()
    }
  },
  async ({ topics, agents, persona, skills, maxContextChars }) => {
    const results: string[] = [];

    for (const topic of topics) {
      const prompt = await buildChatPrompt(
        topic,
        agents ?? ["product-manager", "architect", "qa-engineer"],
        persona,
        skills ?? [],
        [],
        4,
        maxContextChars
      );
      results.push("## " + topic + "\n\n" + prompt);
    }

    const batchReport = results.join("\n\n---\n\n");

    return {
      content: [
        {
          type: "text",
          text: "# バッチ処理レポート\n\n**処理トピック数**: " + topics.length + "\n\n" + batchReport
        }
      ]
    };
  }
);

govTool(
  "generate_kamiless_from_requirements",
  {
    title: "Generate Kamiless From Requirements",
    description:
      "テスト要件テキストを読み取り、*.kamiless.json を自動生成します。" +
      " diff や変更要約も加味して要件を広げ、export JSON まで続けて生成することもできます。",
    inputSchema: {
      requirementsText: z
        .string()
        .optional()
        .describe("要件本文。箇条書き、セクション見出し、項目一覧を含むテキスト"),
      requirementsPath: z
        .string()
        .optional()
        .describe("要件テキストファイルへのパス。requirementsText 未指定時に使用"),
      diffText: z
        .string()
        .optional()
        .describe("git diff や変更差分テキスト。追加行から項目候補を抽出して要件を広げる"),
      diffPath: z
        .string()
        .optional()
        .describe("diff テキストファイルへのパス。diffText 未指定時に使用"),
      specOutputPath: z
        .string()
        .optional()
        .describe("生成する *.kamiless.json の出力先。省略時は outputs/generated.kamiless.json"),
      exportOutputPath: z
        .string()
        .optional()
        .describe("続けて export JSON も生成する場合の出力先"),
      formName: z.string().optional(),
      title: z.string().optional(),
      defaultObjectName: z.string().optional()
    }
  },
  async ({ requirementsText, requirementsPath, diffText, diffPath, specOutputPath, exportOutputPath, formName, title, defaultObjectName }) => {
    let rawText = requirementsText;
    let rawDiffText = diffText;

    if (!rawText && requirementsPath) {
      rawText = await fsPromises.readFile(resolve(requirementsPath), "utf-8");
    }

    if (!rawDiffText && diffPath) {
      rawDiffText = await fsPromises.readFile(resolve(diffPath), "utf-8");
    }

    if (!rawText) {
      return {
        content: [
          {
            type: "text",
            text: "## エラー\n\nrequirementsText または requirementsPath を指定してください。"
          }
        ]
      };
    }

    let specResult;
    try {
      specResult = generateKamilessSpecFromRequirements({
        requirementsText: rawText,
        diffText: rawDiffText,
        formName,
        title,
        defaultObjectName
      });
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: `## エラー\n\n${(err as Error).message}`
          }
        ]
      };
    }

    const finalSpecPath = specOutputPath
      ? resolve(specOutputPath)
      : join(PROJECT_ROOT, "outputs", `${specResult.spec.name}.kamiless.json`);

    await fsPromises.mkdir(dirname(finalSpecPath), { recursive: true });
    await fsPromises.writeFile(finalSpecPath, specResult.json, "utf-8");

    let exportSummary = "";
    if (exportOutputPath) {
      const exportResult = await generateKamilessExport(finalSpecPath);
      await fsPromises.mkdir(dirname(resolve(exportOutputPath)), { recursive: true });
      await fsPromises.writeFile(resolve(exportOutputPath), exportResult.json, "utf-8");
      exportSummary = [
        "",
        "### Export JSON",
        `- 出力: ${resolve(exportOutputPath)}`,
        `- FormLayout: ${exportResult.stats.layoutCount}`,
        `- FormPart: ${exportResult.stats.formPartCount}`,
        `- TargetField: ${exportResult.stats.targetFieldCount}`
      ].join("\n");
    }

    const skipped = specResult.skippedLines.length > 0
      ? `\n### 未解釈行\n${specResult.skippedLines.map((line) => `- ${line}`).join("\n")}`
      : "";

    return {
      content: [
        {
          type: "text",
          text: [
            "## Kamiless Spec 自動生成結果",
            "",
            `- spec 出力: ${finalSpecPath}`,
            `- セクション: ${specResult.stats.sectionCount}`,
            `- 項目: ${specResult.stats.fieldCount}`,
            `- FormPart: ${specResult.stats.partCount}`,
            `- diff 候補行: ${specResult.stats.diffCandidateCount}`,
            `- スキップ行: ${specResult.stats.skippedLineCount}`,
            exportSummary,
            skipped
          ].join("\n")
        }
      ]
    };
  }
);

govTool(
  "generate_kamiless_export",
  {
    title: "Generate Kamiless Export",
    description:
      "kamiless.json オーサリング仕様ファイルから Docutize Form export JSON を生成します。" +
      " specPath または specDir を指定します。どちらも省略した場合はプロジェクトルート配下を検索して一覧を返します。",
    inputSchema: {
      specPath: z
        .string()
        .optional()
        .describe("*.kamiless.json ファイルへの絶対パスまたは相対パス。省略可"),
      specDir: z
        .string()
        .optional()
        .describe("*.kamiless.json を検索するディレクトリパス。省略時は specPath を使用"),
      outputPath: z
        .string()
        .optional()
        .describe("出力先ファイルパス (省略時はレスポンスに JSON を直接返します)")
    }
  },
  async ({ specPath, specDir, outputPath }) => {
    const { promises: fsp } = await import("node:fs");
    const pathMod = await import("node:path");

    // --- ファイル候補を解決 ---
    let targetPaths: string[] = [];

    if (specPath) {
      targetPaths = [pathMod.resolve(specPath)];
    } else {
      // specDir が指定されていなければプロジェクトルートを起点にスキャン
      const scanRoot = specDir ? pathMod.resolve(specDir) : PROJECT_ROOT;

      const findKamiless = (dir: string): string[] => {
        const found: string[] = [];
        let entries: string[];
        try { entries = require("fs").readdirSync(dir); } catch { return found; }
        for (const e of entries) {
          if (e === "node_modules" || e.startsWith(".")) continue;
          const full = pathMod.join(dir, e);
          let stat;
          try { stat = require("fs").statSync(full); } catch { continue; }
          if (stat.isDirectory()) found.push(...findKamiless(full));
          else if (e.endsWith(".kamiless.json")) found.push(full);
        }
        return found;
      };

      targetPaths = findKamiless(scanRoot);

      if (targetPaths.length === 0) {
        return {
          content: [{
            type: "text",
            text: `## ファイルが見つかりません\n\n\`${scanRoot}\` 配下に \`*.kamiless.json\` が存在しません。\n\`specPath\` または \`specDir\` を指定してください。`
          }]
        };
      }

      // 複数ある場合は一覧を返して選択を促す
      if (targetPaths.length > 1) {
        const list = targetPaths.map((p, i) => `${i + 1}. \`${p}\``).join("\n");
        return {
          content: [{
            type: "text",
            text: `## *.kamiless.json が複数見つかりました\n\n${list}\n\n\`specPath\` で対象ファイルを指定して再実行してください。`
          }]
        };
      }

      // 1件のみなら自動選択
    }

    const results: string[] = [];

    for (const sp of targetPaths) {
      let result;
      try {
        result = await generateKamilessExport(sp);
      } catch (err) {
        results.push(`## エラー (${sp})\n\n${(err as Error).message}`);
        continue;
      }

      const dest = outputPath ??
        pathMod.join(pathMod.dirname(sp), pathMod.basename(sp, ".kamiless.json") + "-export.json");

      await fsp.writeFile(dest, result.json, "utf-8");

      results.push([
        `## Kamiless Export 生成結果`,
        ``,
        `**入力**: \`${sp}\``,
        `**出力**: \`${dest}\``,
        `**FormTemplate ID**: \`${result.idMap.formTemplate}\``,
        ``,
        `### 統計`,
        `| 項目 | 件数 |`,
        `|------|------|`,
        `| FormLayout | ${result.stats.layoutCount} |`,
        `| FormPart | ${result.stats.formPartCount} |`,
        `| TargetFieldSection | ${result.stats.targetFieldSectionCount} |`,
        `| TargetField | ${result.stats.targetFieldCount} |`,
        `| 画像 | ${result.stats.imageCount} |`,
      ].join("\n"));
    }

    return {
      content: [{ type: "text", text: results.join("\n\n---\n\n") }]
    };
  }
);

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
  // 名前の正規化・重複チェック
  const existingSkills = await listSkillsCatalog();
  if (existingSkills.some(s => s.name.toLowerCase() === skillName.toLowerCase())) {
    return {
      success: false,
      message: `スキル名が重複: ${skillName}`
    };
  }

  // 品質チェック
  const qualityCheck = checkResourceQuality("skills", {
    name: skillName,
    summary: skillContent.slice(0, 100),
    content: skillContent
  });

  if (!qualityCheck.pass) {
    return {
      success: false,
      message: `品質チェック失敗: ${qualityCheck.errors.map(e => e.message).join(", ")}`,
      qualityScore: qualityCheck.score
    };
  }

  return {
    success: true,
    message: "検証成功",
    qualityScore: qualityCheck.score
  };
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
  // 重複チェック
  const existingPresets = await listPresetsCatalog();
  if (existingPresets.some(p => p.toLowerCase() === presetName.toLowerCase())) {
    return {
      success: false,
      message: `プリセット名が重複: ${presetName}`
    };
  }

  // 品質チェック
  const qualityCheck = checkResourceQuality("presets", {
    name: presetName,
    description: presetData.description,
    agents: presetData.agents
  });

  if (!qualityCheck.pass) {
    return {
      success: false,
      message: `品質チェック失敗: ${qualityCheck.errors.map(e => e.message).join(", ")}`,
      qualityScore: qualityCheck.score
    };
  }

  return {
    success: true,
    message: "検証成功",
    qualityScore: qualityCheck.score
  };
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
  // 重複チェック
  const existingTools = listToolsCatalog(state);
  if (existingTools.some(t => t.toLowerCase() === toolName.toLowerCase())) {
    return {
      success: false,
      message: `ツール名が重複: ${toolName}`
    };
  }

  // 品質チェック
  const qualityCheck = checkResourceQuality("tools", {
    name: toolName,
    description: toolDescription
  });

  if (!qualityCheck.pass) {
    return {
      success: false,
      message: `品質チェック失敗: ${qualityCheck.errors.map(e => e.message).join(", ")}`,
      qualityScore: qualityCheck.score
    };
  }

  return {
    success: true,
    message: "検証成功",
    qualityScore: qualityCheck.score
  };
}

async function main(): Promise<void> {
  // 起動時: カスタムツールを読み込み登録、disabled キャッシュを初期化
  await loadAndRegisterCustomTools();
  await refreshDisabledToolsCache();

  // ============================================================
  // Phase 5: Auto-Initialize Handlers (Event-Driven Auto-Execution)
  // ============================================================
  const handlersState = initializeHandlersState();
  autoInitializeHandlers(handlersState);
  console.log("[Server] Handlers auto-initialization complete");

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

