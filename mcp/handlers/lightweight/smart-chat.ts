import { existsSync } from "fs";
import { resolve } from "path";
import { z } from "zod";
import { analyzeRepo } from "../../tools/repo-analyzer.js";
import { formatErrorMessage } from "../../core/errors/tool-error.js";
import { createLogger } from "../../core/logging/logger.js";
import { scoreByQuery } from "../../core/resource/topic-skill-ranking.js";
import { inferToolCategoryFromTopic, recommendAgentsForToolCategory } from "../../core/resource/tool-categorizer.js";
import { cosineSimilarity } from "../../core/llm/embedding-provider.js";
import { getDefaultLangChainEmbeddingProvider } from "../../core/llm/langchain-embedding.js";
import {
  getLlmClientMode,
  getAgentTrustScoringEnabled,
  getAgentTrustThreshold
} from "../../core/config/runtime-config.js";
import type { RegisterSmartChatToolsDeps } from "../register-smart-chat-tools.js";

const logger = createLogger("SmartChatTools");

function summarizeProactiveRagMatches(
  matches: Array<{ id: string; text: string; score?: number }>
): string {
  if (matches.length === 0) return "";
  const lines = ["### 自動RAG参照", "関連する過去メモを先回りで抽出しました。必要なものだけ採用してください。"];
  for (const match of matches) {
    const snippet = match.text.length > 180 ? `${match.text.slice(0, 180)}...` : match.text;
    const score = typeof match.score === "number" ? ` (score=${match.score.toFixed(3)})` : "";
    lines.push(`- [${match.id}]${score} ${snippet}`);
  }
  return lines.join("\n");
}

async function rerankMatchesWithLangChain(
  topic: string,
  matches: Array<{ id: string; text: string; score?: number }>
): Promise<Array<{ id: string; text: string; score?: number }>> {
  if (matches.length <= 1) {
    return matches;
  }

  const provider = getDefaultLangChainEmbeddingProvider();
  const queryVector = await provider.embed(topic);
  const scored = await Promise.all(matches.map(async (item) => {
    const itemVector = await provider.embed(item.text);
    return {
      ...item,
      score: cosineSimilarity(queryVector, itemVector)
    };
  }));

  scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return scored;
}

function extractExistingFilePathsFromTopic(topic: string): string[] {
  const matches = topic.match(
    /(?:[A-Za-z]:[\\\/]|\.\.?[\\\/])[A-Za-z0-9\-._\s\\\/]+\.[A-Za-z0-9]+/g
  ) ?? [];
  const unique = Array.from(new Set(matches.map((v) => v.replace(/\\/g, "/"))));
  return unique.filter((candidate) => existsSync(candidate));
}

export function defineSmartChatTool(deps: RegisterSmartChatToolsDeps): void {
  const { govTool, root, filterDisabledSkills, searchByKeywordAsync, buildChatPrompt } = deps;

  govTool(
    "smart_chat",
    {
      title: "スマートチャット",
      description: "関連ファイルを自動検出してスマートチャットを実行します。",
      inputSchema: {
        topic: z.string(),
        agents: z.array(z.string()).optional(),
        persona: z.string().optional(),
        skills: z.array(z.string()).optional(),
        repoPath: z.string().optional(),
        maxContextChars: z.number().int().min(500).max(200000).optional(),
        appendInstruction: z.string().optional(),
        enableTrustScoring: z.boolean().optional(),
        trustThreshold: z.number().min(0).max(1).optional()
      }
    },
    async ({ topic, agents, persona, skills, repoPath, maxContextChars, appendInstruction, enableTrustScoring, trustThreshold }: {
      topic: string;
      agents?: string[];
      persona?: string;
      skills?: string[];
      repoPath?: string;
      maxContextChars?: number;
      appendInstruction?: string;
      enableTrustScoring?: boolean;
      trustThreshold?: number;
    }) => {
      const targetPath = resolve(repoPath ?? root);
      const includeProjectContext = resolve(root) === targetPath;
      let autoFilePaths: string[] = [];
      const { enabled: enabledSkills } = await filterDisabledSkills(skills ?? []);
      const trustScoringEnabled = enableTrustScoring ?? getAgentTrustScoringEnabled();
      const selectedAgents = agents ?? ["product-manager", "architect", "qa-engineer"];
      const inferredCategory = inferToolCategoryFromTopic(topic);
      const categoryHints = recommendAgentsForToolCategory(inferredCategory);
      const prioritizedAgents = [...selectedAgents]
        .map((agentName) => {
          const queryScore = scoreByQuery(topic, agentName);
          const categoryBoost = categoryHints.indexOf(agentName) >= 0 ? categoryHints.length - categoryHints.indexOf(agentName) : 0;
          return {
            name: agentName,
            score: trustScoringEnabled ? queryScore + categoryBoost * 10 : categoryBoost
          };
        })
        .sort((a, b) => b.score - a.score)
        .map((row) => row.name);

      const topicFilePaths = extractExistingFilePathsFromTopic(topic);
      if (topicFilePaths.length > 0) {
        autoFilePaths = topicFilePaths;
      }

      let proactiveRagMatches: Array<{ id: string; text: string; score?: number }> = [];
      if (searchByKeywordAsync) {
        try {
          proactiveRagMatches = await searchByKeywordAsync(topic, { limit: 3, minScore: 0.1 });
          if (getLlmClientMode() === "langchain") {
            proactiveRagMatches = await rerankMatchesWithLangChain(topic, proactiveRagMatches);
          }
        } catch (err) {
          const error = formatErrorMessage(err);
          logger.warn("proactive vector retrieval failed", { error });
        }
      }

      try {
        const repoAnalysis = analyzeRepo(targetPath);
        const candidates = [
          ...(repoAnalysis.apex?.slice(0, 1) ?? []),
          ...(repoAnalysis.lwc?.slice(0, 1) ?? []),
          ...(repoAnalysis.objects?.slice(0, 1) ?? [])
        ];
        const analyzedPaths = candidates.filter((pathValue) => pathValue && existsSync(pathValue));
        autoFilePaths = Array.from(new Set([...autoFilePaths, ...analyzedPaths]));
      } catch (err) {
        const error = formatErrorMessage(err);
        logger.warn("repo_analyze failed", { error });
      }

      const ragInstruction = summarizeProactiveRagMatches(proactiveRagMatches);
      const mergedAppendInstruction = [appendInstruction, ragInstruction]
        .filter((value): value is string => Boolean(value && value.trim().length > 0))
        .join("\n\n");

      const prompt = await buildChatPrompt(
        topic,
        prioritizedAgents,
        persona,
        enabledSkills,
        autoFilePaths,
        6,
        maxContextChars,
        mergedAppendInstruction || undefined,
        includeProjectContext
      );

      return {
        content: [
          {
            type: "text",
            text:
              "対象リポジトリ:\n" +
              targetPath +
              "\n\n自動検出ファイル:\n" +
              (autoFilePaths.length > 0 ? autoFilePaths.join("\n") : "(なし)") +
              "\n\n自動RAG候補:\n" +
              (proactiveRagMatches.length > 0 ? proactiveRagMatches.map((item) => item.id).join("\n") : "(なし)") +
              "\n\n信頼スコア機能:\n" +
              (trustScoringEnabled
                ? `有効 (threshold=${(trustThreshold ?? getAgentTrustThreshold()).toFixed(2)})`
                : "無効") +
              (inferredCategory
                ? `\n推定カテゴリ: ${inferredCategory}`
                : "") +
              (trustScoringEnabled
                ? "\n優先エージェント順:\n" + prioritizedAgents.join("\n")
                : "") +
              "\n\n" +
              prompt
          }
        ]
      };
    }
  );
}
