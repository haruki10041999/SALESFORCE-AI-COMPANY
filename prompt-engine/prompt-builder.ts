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
  reasoning: string;
  strategyName?: string;
  strategyGuidance?: string;
};

export type ReasoningStrategy = "plan" | "reflect" | "tree-of-thought";

export interface BuildPromptOptions {
  strategy?: ReasoningStrategy | "auto";
}

const STRATEGY_GUIDANCE: Record<ReasoningStrategy, string> = {
  plan: "Break work into concrete steps, map dependencies, then execute in order.",
  reflect: "Propose an initial answer, self-critique it, and refine before finalizing.",
  "tree-of-thought": "Explore at least two alternative solution branches, compare trade-offs, then choose one."
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
  "{{reasoning}}",
  "",
  "ReasoningStrategy",
  "{{strategyName}}",
  "{{strategyGuidance}}"
].join("\n");

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

export function selectReasoningStrategy(task: string): ReasoningStrategy {
  const normalized = task.toLowerCase();
  if (/compare|trade-?off|alternative|選択肢|比較|複数案/.test(normalized)) {
    return "tree-of-thought";
  }
  if (/review|debug|fix|improve|検証|レビュー|改善|振り返り/.test(normalized)) {
    return "reflect";
  }
  return "plan";
}

export function buildPrompt(agent: AgentProfile, task: string, options: BuildPromptOptions = {}): string {
  const base = fs.readFileSync(join(__dirname, "base-prompt.md"), "utf-8");
  const reasoning = fs.readFileSync(join(__dirname, "reasoning-framework.md"), "utf-8");
  const selected = options.strategy && options.strategy !== "auto"
    ? options.strategy
    : selectReasoningStrategy(task);

  return renderPromptTemplate(DEFAULT_PROMPT_TEMPLATE, {
    agent,
    task,
    base,
    reasoning,
    strategyName: selected,
    strategyGuidance: STRATEGY_GUIDANCE[selected]
  });
}
