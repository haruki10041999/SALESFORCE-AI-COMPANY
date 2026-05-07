import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export type AgentProfile = {
  name: string;
  content: string;
};

export type PromptTemplateData = {
  agent: AgentProfile;
  task: string;
  base: string;
  framework: string;
  frameworkLabel: string;
  modeInstructions?: string;
  variantName?: string;
  strategyName?: string;
  strategyGuidance?: string;
};

export type ReasoningStrategy = "plan" | "reflect" | "tree-of-thought";
export type PromptVariant = "default" | "review" | "discussion";

export interface BuildPromptOptions {
  strategy?: ReasoningStrategy | "auto";
  variant?: PromptVariant | "auto";
}

const STRATEGY_GUIDANCE: Record<ReasoningStrategy, string> = {
  plan: "Break work into concrete steps, map dependencies, then execute in order.",
  reflect: "Propose an initial answer, self-critique it, and refine before finalizing.",
  "tree-of-thought": "Explore at least two alternative solution branches, compare trade-offs, then choose one."
};

const STRATEGY_SEMANTIC_CUES: Record<ReasoningStrategy, string[]> = {
  plan: [
    "implement",
    "build",
    "setup",
    "design",
    "roadmap",
    "step",
    "plan",
    "実装",
    "設計",
    "手順",
    "計画"
  ],
  reflect: [
    "review",
    "audit",
    "inspect",
    "debug",
    "fix",
    "improve",
    "refine",
    "validate",
    "検証",
    "改善",
    "監査",
    "振り返り"
  ],
  "tree-of-thought": [
    "compare",
    "alternative",
    "alternatives",
    "options",
    "tradeoff",
    "trade-off",
    "branch",
    "choose",
    "evaluate",
    "比較",
    "選択肢",
    "複数案",
    "分岐",
    "合意"
  ]
};

const DEFAULT_PROMPT_TEMPLATE = [
  "{{base}}",
  "",
  "Agent",
  "{{agent.name}}",
  "",
  "{{agent.content}}",
  "",
  "Task",
  "{{task}}",
  "",
  "PromptVariant",
  "{{variantName}}",
  "",
  "{{frameworkLabel}}",
  "{{framework}}",
  "",
  "ModeInstructions",
  "{{modeInstructions}}",
  "",
  "ReasoningStrategy",
  "{{strategyName}}",
  "{{strategyGuidance}}"
].join("\n");

const FRAMEWORK_FILES: Record<PromptVariant, { frameworkFile: string; frameworkLabel: string; modeFile?: string }> = {
  default: {
    frameworkFile: "reasoning-framework.md",
    frameworkLabel: "ReasoningFramework"
  },
  review: {
    frameworkFile: "review-framework.md",
    frameworkLabel: "ReviewFramework",
    modeFile: "review-mode.md"
  },
  discussion: {
    frameworkFile: "discussion-framework.md",
    frameworkLabel: "DiscussionFramework"
  }
};

function resolveTemplatePath(data: unknown, path: string): string {
  const value = path
    .split(".")
    .reduce<unknown>((acc, key) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined), data);
  if (value === undefined || value === null) return "";
  return String(value);
}

/**
 * Lightweight Mustache-like variable renderer.
 * Supports {{a}} and nested {{a.b}} placeholders.
 */
export function renderPromptTemplate(template: string, data: PromptTemplateData): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, path: string) => {
    return resolveTemplatePath(data, path);
  });
}

function tokenizeForSemanticScore(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9\u3040-\u30ff\u4e00-\u9faf]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function semanticCueScore(task: string, cues: string[]): number {
  const tokens = tokenizeForSemanticScore(task);
  if (tokens.length === 0) return 0;
  const tokenSet = new Set(tokens);
  let score = 0;
  for (const cue of cues) {
    const normalizedCue = cue.toLowerCase();
    if (tokenSet.has(normalizedCue)) {
      score += 1;
      continue;
    }
    if (tokens.some((token) => token.includes(normalizedCue) || normalizedCue.includes(token))) {
      score += 0.5;
    }
  }
  return score;
}

export function selectReasoningStrategy(task: string): ReasoningStrategy {
  const normalized = task.toLowerCase();
  const semanticScores = (Object.keys(STRATEGY_SEMANTIC_CUES) as ReasoningStrategy[])
    .map((strategy) => ({
      strategy,
      score: semanticCueScore(normalized, STRATEGY_SEMANTIC_CUES[strategy])
    }))
    .sort((a, b) => b.score - a.score);

  if ((semanticScores[0]?.score ?? 0) >= 1) {
    return semanticScores[0]!.strategy;
  }

  if (/compare|trade-?off|alternative|選択肢|比較|複数案/.test(normalized)) {
    return "tree-of-thought";
  }
  if (/review|debug|fix|improve|検証|レビュー|改善|振り返り/.test(normalized)) {
    return "reflect";
  }
  return "plan";
}

export function selectPromptVariant(task: string): PromptVariant {
  const normalized = task.toLowerCase();
  if (/review|レビュー|確認|チェック|査読/.test(normalized)) {
    return "review";
  }
  if (/compare|discussion|discuss|trade-?off|alternative|選択肢|比較|議論|合意/.test(normalized)) {
    return "discussion";
  }
  return "default";
}

export function buildPrompt(agent: AgentProfile, task: string, options: BuildPromptOptions = {}): string {
  const base = fs.readFileSync(join(__dirname, "base-prompt.md"), "utf-8");
  const selected = options.strategy && options.strategy !== "auto"
    ? options.strategy
    : selectReasoningStrategy(task);
  const variant = options.variant && options.variant !== "auto"
    ? options.variant
    : selectPromptVariant(task);
  const variantConfig = FRAMEWORK_FILES[variant];
  const framework = fs.readFileSync(join(__dirname, variantConfig.frameworkFile), "utf-8");
  const modeInstructions = variantConfig.modeFile
    ? fs.readFileSync(join(__dirname, variantConfig.modeFile), "utf-8")
    : "";

  return renderPromptTemplate(DEFAULT_PROMPT_TEMPLATE, {
    agent,
    task,
    base,
    framework,
    frameworkLabel: variantConfig.frameworkLabel,
    modeInstructions,
    variantName: variant,
    strategyName: selected,
    strategyGuidance: STRATEGY_GUIDANCE[selected]
  });
}
