import { existsSync } from "fs";
import { resolve } from "path";
import { z } from "zod";
import { analyzeRepo } from "../tools/repo-analyzer.js";
import type { GovTool } from "@mcp/tool-types.js";

interface RegisterSmartChatToolsDeps {
  govTool: GovTool;
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
  const matches = topic.match(/[A-Za-z]:\/[\w\-./]+\.[A-Za-z0-9]+|\.?\.\/?[\w\-./]+\.[A-Za-z0-9]+/g) ?? [];
  const unique = Array.from(new Set(matches.map((v) => v.replace(/\\/g, "/"))));
  return unique.filter((candidate) => existsSync(candidate));
}

export function registerSmartChatTools(deps: RegisterSmartChatToolsDeps): void {
  const { govTool, root, filterDisabledSkills, buildChatPrompt } = deps;

  govTool(
    "smart_chat",
    {
      title: "Smart Chat",
      description: "Auto-generated description.",
      inputSchema: {
        topic: z.string(),
        agents: z.array(z.string()).optional(),
        persona: z.string().optional(),
        skills: z.array(z.string()).optional(),
        repoPath: z.string().optional(),
        maxContextChars: z.number().int().min(500).max(200000).optional(),
        appendInstruction: z.string().optional()
      }
    },
    async ({ topic, agents, persona, skills, repoPath, maxContextChars, appendInstruction }: {
      topic: string;
      agents?: string[];
      persona?: string;
      skills?: string[];
      repoPath?: string;
      maxContextChars?: number;
      appendInstruction?: string;
    }) => {
      const targetPath = resolve(repoPath ?? root);
      const includeProjectContext = resolve(root) === targetPath;
      let autoFilePaths: string[] = [];
      const { enabled: enabledSkills } = await filterDisabledSkills(skills ?? []);

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
      } catch {
        // repo_analyze 螟ｱ謨玲凾縺ｯ遨ｺ驟榊・縺ｧ邯夊｡・
      }

      const prompt = await buildChatPrompt(
        topic,
        agents ?? ["product-manager", "architect", "qa-engineer"],
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
              "縲仙ｯｾ雎｡繝ｪ繝昴ず繝医Μ縲曾n" +
              targetPath +
              "\n\n縲占・蜍墓､懷・繝輔ぃ繧､繝ｫ縲曾n" +
              (autoFilePaths.length > 0 ? autoFilePaths.join("\n") : "(縺ｪ縺・") +
              "\n\n" +
              prompt
          }
        ]
      };
    }
  );
}
