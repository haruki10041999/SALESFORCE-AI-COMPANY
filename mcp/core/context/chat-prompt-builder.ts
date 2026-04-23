import { existsSync, readFileSync, promises as fsPromises } from "fs";
import { join, relative } from "path";

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
  const maxEntries = Math.max(1, parseInt(process.env.PROMPT_CACHE_MAX_ENTRIES || "100", 10));
  const ttlSeconds = Math.max(1, parseInt(process.env.PROMPT_CACHE_TTL_SECONDS || "60", 10));
  return {
    maxEntries,
    ttlMs: ttlSeconds * 1000
  };
}

const promptCache = new Map<string, { prompt: string; createdAt: number }>();

function createPromptCacheKey(input: BuildChatPromptInput, root: string): string {
  return JSON.stringify({ root, ...input });
}

function getCachedPrompt(cacheKey: string): string | null {
  const cached = promptCache.get(cacheKey);
  if (!cached) {
    return null;
  }
  const { ttlMs } = getPromptCacheConfig();
  if (Date.now() - cached.createdAt > ttlMs) {
    promptCache.delete(cacheKey);
    return null;
  }
  return cached.prompt;
}

function setCachedPrompt(cacheKey: string, prompt: string): void {
  const { maxEntries } = getPromptCacheConfig();
  if (promptCache.size >= maxEntries) {
    const oldestKey = promptCache.keys().next().value;
    if (oldestKey) {
      promptCache.delete(oldestKey);
    }
  }
  promptCache.set(cacheKey, { prompt, createdAt: Date.now() });
}

export function clearBuildChatPromptCache(): void {
  promptCache.clear();
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

  const totalItems = filePaths.length + selectedAgents.length + skillNames.length + (personaName ? 1 : 0) + contextFiles.length;
  const perItemBudget = maxContextChars && totalItems > 0
    ? Math.floor(maxContextChars / Math.max(totalItems, 1))
    : undefined;

  const [codeResults, agentResults, skillResults, personaResult] = await Promise.all([
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
        return perItemBudget
          ? truncateContent(raw, perItemBudget, `context:${toPosixPath(relative(root, f))}`)
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

  const discussionFrameworkPath = join(root, "prompt-engine", "discussion-framework.md");
  if (existsSync(discussionFrameworkPath)) {
    const raw = readFileSync(discussionFrameworkPath, "utf-8");
    const content = perItemBudget ? truncateContent(raw, perItemBudget, "discussion-framework") : raw;
    sections.push(`## ディスカッション規約\n\n${content}`);
  }

  if (filePaths.length > 0) {
    const reviewFrameworkPath = join(root, "prompt-engine", "review-framework.md");
    if (existsSync(reviewFrameworkPath)) {
      const raw = readFileSync(reviewFrameworkPath, "utf-8");
      const content = perItemBudget ? truncateContent(raw, perItemBudget, "review-framework") : raw;
      sections.push(`## レビュー観点\n\n${content}`);
    }
  }

  if (reviewModeTriggered) {
    const reviewModePath = join(root, "prompt-engine", "review-mode.md");
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

  const prompt = sections.join("\n\n---\n\n");
  setCachedPrompt(cacheKey, prompt);
  return prompt;
}
