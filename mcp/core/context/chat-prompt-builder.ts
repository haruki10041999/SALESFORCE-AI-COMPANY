import { existsSync, readFileSync, promises as fsPromises } from "fs";
import { join, relative } from "path";
import { createHash } from "crypto";
import { getPromptCacheMaxEntries, getPromptCacheTtlSeconds } from "../config/runtime-config.js";
import { renderPersonaStyleSection } from "./persona-style-registry.js";
import { renderSpeechStyleSection } from "./speech-style-registry.js";
import { allocateCategoryBudgets } from "./context-budget.js";
import {
  loadPromptCacheFromDisk,
  appendPromptCacheEntry,
  clearPromptCacheFile,
  rewritePromptCacheFile,
  type PersistedCacheEntry
} from "./prompt-cache-persistence.js";

interface BuildChatPromptDeps {
  root: string;
  findMdFilesRecursive: (dir: string) => string[];
  toPosixPath: (value: string) => string;
  truncateContent: (text: string, maxChars: number, label?: string) => string;
  getMdFileAsync: (dir: string, name: string) => Promise<string>;
}

interface BuildChatPromptInput {
  topic: string;
  agentNames: string[];
  personaName: string | undefined;
  skillNames: string[];
  filePaths: string[];
  turns: number;
  maxContextChars?: number;
  appendInstruction?: string;
  includeProjectContext?: boolean;
}

/**
 * Parse configuration from environment variables with defaults
 * - PROMPT_CACHE_MAX_ENTRIES: max cache size (default: 100)
 * - PROMPT_CACHE_TTL_SECONDS: cache TTL in seconds (default: 60)
 */
function getPromptCacheConfig(): { maxEntries: number; ttlMs: number } {
  const maxEntries = getPromptCacheMaxEntries();
  const ttlSeconds = getPromptCacheTtlSeconds();
  return {
    maxEntries,
    ttlMs: ttlSeconds * 1000
  };
}

const promptCache = new Map<string, { prompt: string; createdAt: number; input: BuildChatPromptInput }>();

// ============================================================================
// TASK-046: Prompt Cache Persistence
// ============================================================================

/**
 * 永続化先ファイルパス。env `PROMPT_CACHE_FILE` で有効化される。
 * 未設定や空文字列なら永続化は無効 (従来振る舞い)。
 */
function getPromptCacheFilePath(): string | null {
  const value = process.env.PROMPT_CACHE_FILE;
  if (!value || value.trim().length === 0) return null;
  return value.trim();
}

let hydrated = false;

/**
 * プロセス起動後 1 回だけ disk から cache をロードする。
 * テストやセットアップ以外は getCachedPrompt / setCachedPrompt から自動呼ばれる。
 */
function hydratePromptCacheIfNeeded(): void {
  if (hydrated) return;
  hydrated = true;
  const file = getPromptCacheFilePath();
  if (!file) return;
  const { ttlMs } = getPromptCacheConfig();
  try {
    const persisted = loadPromptCacheFromDisk<BuildChatPromptInput>(file, { ttlMs });
    for (const [key, entry] of persisted) {
      promptCache.set(key, { prompt: entry.prompt, createdAt: entry.createdAt, input: entry.input });
    }
  } catch {
    // hydration 失敗は cache 不使用と同価 (fallback)
  }
}

/**
 * テスト用: hydration フラグをリセットして再ロードさせる。
 */
export function resetPromptCacheHydrationForTest(): void {
  hydrated = false;
  promptCache.clear();
}

/**
 * テスト用: 現在の in-memory cache サイズを返す。
 */
export function getPromptCacheSizeForTest(): number {
  return promptCache.size;
}

// Cache metrics for monitoring
export interface PromptCacheMetrics {
  hits: number;
  misses: number;
  evictions: number;
  expirations: number;
  size: number;
  maxSize: number;
}

let cacheMetrics = {
  hits: 0,
  misses: 0,
  evictions: 0,
  expirations: 0
};

export function getPromptCacheMetrics(): PromptCacheMetrics {
  const { maxEntries } = getPromptCacheConfig();
  return {
    ...cacheMetrics,
    size: promptCache.size,
    maxSize: maxEntries
  };
}

export function resetPromptCacheMetrics(): void {
  cacheMetrics = {
    hits: 0,
    misses: 0,
    evictions: 0,
    expirations: 0
  };
}

/**
 * 任意の値を JSON シリアライズする際に、オブジェクトのキーを再帰的にソートして
 * プロパティ順に依存しない安定文字列を生成する
 */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return "[" + value.map((item) => stableStringify(item)).join(",") + "]";
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return (
      "{" +
      keys
        .map((key) => JSON.stringify(key) + ":" + stableStringify(obj[key]))
        .join(",") +
      "}"
    );
  }
  return JSON.stringify(value);
}

export function createPromptCacheKey(input: BuildChatPromptInput, root: string): string {
  // 配列フィールドはセマンティクス上順序非依存とみなし、正規化のためソートする
  const normalized: Record<string, unknown> = {
    root,
    topic: input.topic,
    agentNames: [...input.agentNames].sort(),
    personaName: input.personaName,
    skillNames: [...input.skillNames].sort(),
    filePaths: [...input.filePaths].sort(),
    turns: input.turns,
    maxContextChars: input.maxContextChars,
    appendInstruction: input.appendInstruction,
    includeProjectContext: input.includeProjectContext
  };
  const canonical = stableStringify(normalized);
  return createHash("sha256").update(canonical).digest("hex");
}

function getCachedPrompt(cacheKey: string): string | null {
  hydratePromptCacheIfNeeded();
  const cached = promptCache.get(cacheKey);
  if (!cached) {
    cacheMetrics.misses++;
    return null;
  }
  const { ttlMs } = getPromptCacheConfig();
  if (Date.now() - cached.createdAt > ttlMs) {
    promptCache.delete(cacheKey);
    cacheMetrics.misses++;
    cacheMetrics.expirations++;
    return null;
  }
  cacheMetrics.hits++;
  return cached.prompt;
}

function setCachedPrompt(cacheKey: string, prompt: string, input: BuildChatPromptInput): void {
  hydratePromptCacheIfNeeded();
  const { maxEntries } = getPromptCacheConfig();
  if (promptCache.size >= maxEntries) {
    const oldestKey = promptCache.keys().next().value;
    if (oldestKey) {
      promptCache.delete(oldestKey);
      cacheMetrics.evictions++;
    }
  }
  const createdAt = Date.now();
  promptCache.set(cacheKey, { prompt, createdAt, input });

  // TASK-046: 永続化
  const file = getPromptCacheFilePath();
  if (file) {
    try {
      appendPromptCacheEntry<BuildChatPromptInput>(file, { key: cacheKey, prompt, createdAt, input });
    } catch {
      // 失敗しても in-memory は生きているので黙って fallback
    }
  }
}

export function clearBuildChatPromptCache(): void {
  promptCache.clear();
  const file = getPromptCacheFilePath();
  if (file) {
    try {
      clearPromptCacheFile(file);
    } catch {
      // ignore
    }
  }
}

/**
 * コンパクション: メモリ上の有効 entry をファイルに書き戻す。
 * append 運用で肥大化したときに手動呼び出しを想定。
 */
export function compactPromptCacheFile(): void {
  const file = getPromptCacheFilePath();
  if (!file) return;
  const entries: PersistedCacheEntry<BuildChatPromptInput>[] = [];
  for (const [key, value] of promptCache) {
    entries.push({ key, prompt: value.prompt, createdAt: value.createdAt, input: value.input });
  }
  try {
    rewritePromptCacheFile<BuildChatPromptInput>(file, entries);
  } catch {
    // ignore
  }
}

/**
 * Invalidate cache entries matching a pattern based on input attributes.
 * Useful when specific agents, skills, or file paths change.
 * @param pattern - Partial input object to match for invalidation
 * @example
 * invalidateBuildChatPromptCache({ agentNames: ["agent1"] });
 */
export function invalidateBuildChatPromptCache(pattern: Partial<BuildChatPromptInput>): void {
  const keysToDelete: string[] = [];
  for (const [key, value] of promptCache.entries()) {
    const cached = value.input;
    let matches = true;
    for (const [patternKey, patternValue] of Object.entries(pattern)) {
      if (patternKey === "agentNames" && Array.isArray(patternValue)) {
        const hasAny = patternValue.some((agent: string) =>
          (cached.agentNames || []).includes(agent)
        );
        if (!hasAny) matches = false;
      } else if (patternKey === "skillNames" && Array.isArray(patternValue)) {
        const hasAny = patternValue.some((skill: string) =>
          (cached.skillNames || []).includes(skill)
        );
        if (!hasAny) matches = false;
      } else if (patternKey === "personaName" && patternValue === cached.personaName) {
        matches = true;
      } else if (patternKey === "topic" && patternValue === cached.topic) {
        matches = true;
      } else if (patternKey === "filePaths" && Array.isArray(patternValue)) {
        const hasAny = patternValue.some((path: string) =>
          (cached.filePaths || []).includes(path)
        );
        if (!hasAny) matches = false;
      }
    }
    if (matches) {
      keysToDelete.push(key);
    }
  }
  for (const key of keysToDelete) {
    promptCache.delete(key);
  }
}

export async function buildChatPromptFromContext(
  input: BuildChatPromptInput,
  deps: BuildChatPromptDeps
): Promise<string> {
  const {
    topic,
    agentNames,
    personaName,
    skillNames,
    filePaths,
    turns,
    maxContextChars,
    appendInstruction,
    includeProjectContext
  } = input;
  const {
    root,
    findMdFilesRecursive,
    toPosixPath,
    truncateContent,
    getMdFileAsync
  } = deps;

  const cacheKey = createPromptCacheKey(input, root);
  const cachedPrompt = getCachedPrompt(cacheKey);
  if (cachedPrompt) {
    return cachedPrompt;
  }

  const selectedAgents = agentNames.length > 0 ? agentNames : ["product-manager", "architect", "qa-engineer"];

  const shouldIncludeProjectContext = includeProjectContext ?? true;
  const contextDir = join(root, "context");
  const contextFiles = shouldIncludeProjectContext && existsSync(contextDir)
    ? findMdFilesRecursive(contextDir)
    : [];

  // TASK-F6: weight context budget by category importance instead of dividing
  // maxContextChars equally across every item. Frameworks (discussion /
  // review) consume the same per-item slot through `framework`.
  const categoryBudgets = allocateCategoryBudgets(maxContextChars, {
    agent: selectedAgents.length,
    skill: skillNames.length,
    code: filePaths.length,
    context: contextFiles.length,
    persona: personaName ? 1 : 0,
    framework: 3 // discussion + review + review-mode
  });
  const codeBudget = categoryBudgets.code;
  const agentBudget = categoryBudgets.agent;
  const skillBudget = categoryBudgets.skill;
  const contextBudget = categoryBudgets.context;
  const personaBudget = categoryBudgets.persona;
  const frameworkBudget = categoryBudgets.framework;

  const [codeResults, agentResults, skillResults, personaResult] = await Promise.all([
    Promise.all(filePaths.map(async (fp) => {
      try {
        const code = await fsPromises.readFile(fp, "utf-8");
        const ext = fp.split(".").pop() ?? "";
        const content = codeBudget ? truncateContent(code, codeBudget, fp) : code;
        return `### ${fp}\n\`\`\`${ext}\n${content}\n\`\`\``;
      } catch {
        return `### ${fp}\n(読み込み失敗)`;
      }
    })),
    Promise.all(selectedAgents.map(async (name) => {
      try {
        const raw = await getMdFileAsync("agents", name);
        const content = agentBudget ? truncateContent(raw, agentBudget, `agent:${name}`) : raw;
        return `### ${name}\n${content}`;
      } catch {
        return `### ${name}\n(未定義)`;
      }
    })),
    Promise.all(skillNames.map(async (name) => {
      try {
        const raw = await getMdFileAsync("skills", name);
        const content = skillBudget ? truncateContent(raw, skillBudget, `skill:${name}`) : raw;
        return `### ${name}\n${content}`;
      } catch {
        return `### ${name}\n(未定義)`;
      }
    })),
    personaName
      ? getMdFileAsync("personas", personaName).catch(() => null)
      : Promise.resolve(null)
  ]);

  const sections: string[] = [];
  const reviewModeTriggered = filePaths.length > 0 || /レビュー|確認|チェック/.test(topic);

  if (contextFiles.length > 0) {
    const contextContent = contextFiles
      .map((f) => {
        const raw = readFileSync(f, "utf-8");
        return contextBudget
          ? truncateContent(raw, contextBudget, `context:${toPosixPath(relative(root, f))}`)
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

  const personaContent = personaResult && personaBudget
    ? truncateContent(personaResult, personaBudget, `persona:${personaName ?? ""}`)
    : personaResult;
  if (personaContent) {
    sections.push(`## ペルソナ\n\n${personaContent}`);
  }

  // TASK-040: persona-aware prompt style hints
  if (personaName) {
    sections.push(renderPersonaStyleSection(personaName));
  }

  // T-NEW-01: agent ごとの発話スタイル (一人称・語尾・敬語) を注入
  const speechAgents = agentNames.length > 0 ? agentNames : ["product-manager", "architect", "qa-engineer"];
  const speechBlocks = speechAgents.map((a) => renderSpeechStyleSection(a, personaName ?? null));
  sections.push(`## 発話スタイル一覧\n\n${speechBlocks.join("\n\n")}`);

  const discussionFrameworkPath = join(root, "prompt-engine", "discussion-framework.md");
  if (existsSync(discussionFrameworkPath)) {
    const raw = readFileSync(discussionFrameworkPath, "utf-8");
    const content = frameworkBudget ? truncateContent(raw, frameworkBudget, "discussion-framework") : raw;
    sections.push(`## ディスカッション規約\n\n${content}`);
  }

  if (filePaths.length > 0) {
    const reviewFrameworkPath = join(root, "prompt-engine", "review-framework.md");
    if (existsSync(reviewFrameworkPath)) {
      const raw = readFileSync(reviewFrameworkPath, "utf-8");
      const content = frameworkBudget ? truncateContent(raw, frameworkBudget, "review-framework") : raw;
      sections.push(`## レビュー観点\n\n${content}`);
    }
  }

  if (reviewModeTriggered) {
    const reviewModePath = join(root, "prompt-engine", "review-mode.md");
    if (existsSync(reviewModePath)) {
      const reviewModeRaw = readFileSync(reviewModePath, "utf-8");
      const reviewModeContent = frameworkBudget
        ? truncateContent(reviewModeRaw, frameworkBudget, "review-mode")
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

  const prompt = sections.join("\n\n---\n\n");
  setCachedPrompt(cacheKey, prompt, input);
  return prompt;
}
