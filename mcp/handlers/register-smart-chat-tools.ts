import { existsSync } from "fs";
import { z } from "zod";
import { analyzeRepo } from "../tools/repo-analyzer.js";

type GovTool = (name: string, config: any, handler: any) => void;

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
    appendInstruction?: string
  ) => Promise<string>;
}

export function registerSmartChatTools(deps: RegisterSmartChatToolsDeps): void {
  const { govTool, root, filterDisabledSkills, buildChatPrompt } = deps;

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
      const targetPath = repoPath ?? root;
      let autoFilePaths: string[] = [];
      const { enabled: enabledSkills } = await filterDisabledSkills(skills ?? []);

      try {
        const repoAnalysis = analyzeRepo(targetPath);
        const candidates = [
          ...(repoAnalysis.apex?.slice(0, 1) ?? []),
          ...(repoAnalysis.lwc?.slice(0, 1) ?? []),
          ...(repoAnalysis.objects?.slice(0, 1) ?? [])
        ];
        autoFilePaths = candidates.filter((pathValue) => pathValue && existsSync(pathValue));
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
        maxContextChars,
        appendInstruction
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
}