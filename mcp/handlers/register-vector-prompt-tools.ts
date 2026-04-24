import { z } from "zod";
import type { RegisterGovToolDeps } from "./types.js";
import { createLogger } from "../core/logging/logger.js";

interface RegisterVectorPromptToolsDeps extends RegisterGovToolDeps {
  addRecord: (record: { id: string; text: string; tags: string[] }) => void;
  searchByKeyword: (query: string) => Array<{ id: string; text: string; tags?: string[] }>;
  buildPrompt: (agent: { name: string; content: string }, task: string) => string;
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

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function buildDiagnostics(metrics: {
  containsProjectContext: boolean;
  containsAgentsSection: boolean;
  containsSkillsSection: boolean;
  containsTaskSection: boolean;
  skillCoverageRate: number;
  triggerMatchRate: number;
  matchedSkillCount: number;
  totalSkillCount: number;
  matchedTriggerCount: number;
  totalTriggerCount: number;
}): {
  sectionCoverageRate: number;
  overallScore: number;
  scoreBreakdown: {
    sectionCoverage: number;
    skillCoverage: number;
    triggerCoverage: number;
  };
  rationale: string[];
} {
  const sectionMatchedCount = [
    metrics.containsProjectContext,
    metrics.containsAgentsSection,
    metrics.containsSkillsSection,
    metrics.containsTaskSection
  ].filter(Boolean).length;
  const sectionCoverageRate = sectionMatchedCount / 4;

  const overallScore = sectionCoverageRate * 0.4 + metrics.skillCoverageRate * 0.3 + metrics.triggerMatchRate * 0.3;
  const rationale: string[] = [];

  if (sectionCoverageRate < 1) {
    rationale.push(`セクション網羅が不足 (${sectionMatchedCount}/4)`);
  }
  if (metrics.totalSkillCount > 0 && metrics.matchedSkillCount < metrics.totalSkillCount) {
    rationale.push(`スキル一致が不足 (${metrics.matchedSkillCount}/${metrics.totalSkillCount})`);
  }
  if (metrics.totalTriggerCount > 0 && metrics.matchedTriggerCount < metrics.totalTriggerCount) {
    rationale.push(`トリガー一致が不足 (${metrics.matchedTriggerCount}/${metrics.totalTriggerCount})`);
  }
  if (rationale.length === 0) {
    rationale.push("主要評価指標はすべて閾値を満たしています。");
  }

  return {
    sectionCoverageRate: round2(sectionCoverageRate),
    overallScore: round2(overallScore),
    scoreBreakdown: {
      sectionCoverage: round2(sectionCoverageRate),
      skillCoverage: round2(metrics.skillCoverageRate),
      triggerCoverage: round2(metrics.triggerMatchRate)
    },
    rationale
  };
}

export function registerVectorPromptTools(deps: RegisterVectorPromptToolsDeps): void {
  const { govTool, addRecord, searchByKeyword, buildPrompt, evaluatePromptMetrics } = deps;
  const logger = createLogger("VectorPromptTools");
  const verbosePromptDebug = process.env.SF_AI_DEBUG_VERBOSE_PROMPT === "true";

  govTool(
    "add_vector_record",
    {
      title: "ベクトルレコード追加",
      description: "ベクトルストアにレコードを追加します。",
      inputSchema: {
        id: z.string().min(1),
        text: z.string().min(1),
        tags: z.array(z.string()).optional()
      }
    },
    async ({ id, text, tags }: { id: string; text: string; tags?: string[] }) => {
      addRecord({ id, text, tags: tags ?? [] });
      return {
        content: [{ type: "text", text: `Vector record added: ${id}` }]
      };
    }
  );

  govTool(
    "search_vector",
    {
      title: "ベクトル検索",
      description: "ベクトルストアを検索します。",
      inputSchema: {
        query: z.string().min(1)
      }
    },
    async ({ query }: { query: string }) => {
      const results = searchByKeyword(query);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ query, count: results.length, results }, null, 2)
          }
        ]
      };
    }
  );

  govTool(
    "build_prompt",
    {
      title: "プロンプト構築",
      description: "ベースプロンプトと推論フレームワークから単一エージェント用プロンプトを構築します。",
      inputSchema: {
        agentName: z.string(),
        agentContent: z.string(),
        task: z.string()
      }
    },
    async ({ agentName, agentContent, task }: { agentName: string; agentContent: string; task: string }) => {
      const prompt = buildPrompt({ name: agentName, content: agentContent }, task);
      logger.debug("build_prompt completed", {
        agentName,
        taskLength: task.length,
        promptLength: prompt.length,
        promptLineCount: prompt.split(/\r?\n/).length
      });
      if (verbosePromptDebug) {
        logger.debug("build_prompt full prompt", prompt);
      }
      return {
        content: [{ type: "text", text: prompt }]
      };
    }
  );

  govTool(
    "evaluate_prompt_metrics",
    {
      title: "プロンプト評価指標",
      description: "長さ・セクション網羅率・スキル網羅率・トリガー一致率などのプロンプト品質指標を評価します。",
      inputSchema: {
        prompt: z.string().min(1),
        skills: z.array(z.string()).optional(),
        triggerKeywords: z.array(z.string()).optional()
      }
    },
    async ({ prompt, skills, triggerKeywords }: { prompt: string; skills?: string[]; triggerKeywords?: string[] }) => {
      const metrics = evaluatePromptMetrics(prompt, skills, triggerKeywords);
      const diagnostics = buildDiagnostics(metrics);

      logger.debug("evaluate_prompt_metrics completed", {
        promptLength: metrics.lengthChars,
        promptLineCount: metrics.lineCount,
        scoreBreakdown: diagnostics.scoreBreakdown,
        overallScore: diagnostics.overallScore,
        rationale: diagnostics.rationale
      });
      if (verbosePromptDebug) {
        logger.debug("evaluate_prompt_metrics full prompt", prompt);
      }

      return {
        content: [{ type: "text", text: JSON.stringify({ ...metrics, diagnostics }, null, 2) }]
      };
    }
  );
}

