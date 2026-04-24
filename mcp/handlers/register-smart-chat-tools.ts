import { existsSync } from "fs";
import { resolve } from "path";
import { z } from "zod";
import { analyzeRepo } from "../tools/repo-analyzer.js";
import { formatErrorMessage } from "../core/errors/tool-error.js";
import { createLogger } from "../core/logging/logger.js";
import { scoreByQuery } from "../core/resource/topic-skill-ranking.js";
import {
  getAgentTrustScoringEnabled,
  getAgentTrustThreshold
} from "../core/config/runtime-config.js";
import type { RegisterGovToolDeps } from "./types.js";

const logger = createLogger("SmartChatTools");

interface RegisterSmartChatToolsDeps extends RegisterGovToolDeps {
  root: string;
  filterDisabledSkills: (skillNames: string[]) => Promise<{ enabled: string[]; disabled: string[] }>;
  buildChatPrompt: (
    topic: string,
    agents: string[],
    persona?: string,
    skills?: string[],
    filePaths?: string[],
    maxFiles?: number,
    maxContextChars?: number,
    appendInstruction?: string,
    includeProjectContext?: boolean
  ) => Promise<string>;
}

function extractExistingFilePathsFromTopic(topic: string): string[] {
  // Windows paths: C:\path\to\file.ext, posix paths: ./path/to/file.ext, /path/to/file.ext
  const matches = topic.match(
    /(?:[A-Za-z]:[\\\/]|\.\.?[\\\/])[A-Za-z0-9\-._\s\\\/]+\.[A-Za-z0-9]+/g
  ) ?? [];
  const unique = Array.from(new Set(matches.map((v) => v.replace(/\\/g, "/"))));
  return unique.filter((candidate) => existsSync(candidate));
}

export function registerSmartChatTools(deps: RegisterSmartChatToolsDeps): void {
  const { govTool, root, filterDisabledSkills, buildChatPrompt } = deps;

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
      const prioritizedAgents = trustScoringEnabled
        ? [...selectedAgents]
          .map((agentName) => ({
            name: agentName,
            score: scoreByQuery(topic, agentName)
          }))
          .sort((a, b) => b.score - a.score)
          .map((row) => row.name)
        : selectedAgents;

      const topicFilePaths = extractExistingFilePathsFromTopic(topic);
      if (topicFilePaths.length > 0) {
        autoFilePaths = topicFilePaths;
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
        // repo_analyze 失敗時は空配列で継続（デフォルト動作）
        const error = formatErrorMessage(err);
        logger.warn("repo_analyze failed", { error });
      }

      const prompt = await buildChatPrompt(
        topic,
        prioritizedAgents,
        persona,
        enabledSkills,
        autoFilePaths,
        6,
        maxContextChars,
        appendInstruction,
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
              "\n\n信頼スコア機能:\n" +
              (trustScoringEnabled
                ? `有効 (threshold=${(trustThreshold ?? getAgentTrustThreshold()).toFixed(2)})`
                : "無効") +
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
