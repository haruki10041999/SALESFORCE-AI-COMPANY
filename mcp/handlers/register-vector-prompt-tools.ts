import type { RegisterGovToolDeps } from "./types.js";
import { defineVectorPromptTools } from "./vector-prompt/vector-prompt-tools.js";

export interface RegisterVectorPromptToolsDeps extends RegisterGovToolDeps {
  addRecord: (record: { id: string; text: string; tags: string[] }) => void;
  searchByKeyword: (query: string) => Array<{ id: string; text: string; tags?: string[] }>;
  /** F-11: vector backend (ngram/ollama) 経由の async 検索。tfidf 固定時は省略可。 */
  searchByKeywordAsync?: (
    query: string,
    options?: { limit?: number; minScore?: number }
  ) => Promise<Array<{ id: string; text: string; tags?: string[]; score?: number }>>;
  buildPrompt: (
    agent: { name: string; content: string },
    task: string,
    options?: {
      strategy?: "auto" | "plan" | "reflect" | "tree-of-thought";
      variant?: "auto" | "default" | "review" | "discussion";
    }
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
}

export function registerVectorPromptTools(deps: RegisterVectorPromptToolsDeps): void {
  defineVectorPromptTools(deps);
}

