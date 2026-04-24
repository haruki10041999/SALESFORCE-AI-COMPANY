import { z } from "zod";
import type { RegisterGovToolDeps } from "./types.js";

interface RegisterBatchToolsDeps extends RegisterGovToolDeps {
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

export function registerBatchTools(deps: RegisterBatchToolsDeps): void {
  const { govTool, buildChatPrompt } = deps;

  govTool(
    "batch_chat",
    {
      title: "バッチチャット",
      description: "複数トピックのチャットを一括実行します。",
      inputSchema: {
        topics: z.array(z.string()).min(1).max(10).optional(),
        topicConfigs: z.array(z.object({
          topic: z.string(),
          agents: z.array(z.string()).optional(),
          appendInstruction: z.string().optional()
        })).min(1).max(10).optional(),
        agents: z.array(z.string()).optional(),
        persona: z.string().optional(),
        skills: z.array(z.string()).optional(),
        maxContextChars: z.number().int().min(500).max(200000).optional(),
        appendInstruction: z.string().optional(),
        parallel: z.boolean().optional()
      }
    },
    async ({ topics, topicConfigs, agents, persona, skills, maxContextChars, appendInstruction, parallel }: {
      topics?: string[];
      topicConfigs?: Array<{ topic: string; agents?: string[]; appendInstruction?: string }>;
      agents?: string[];
      persona?: string;
      skills?: string[];
      maxContextChars?: number;
      appendInstruction?: string;
      parallel?: boolean;
    }) => {
      const defaultAgents = ["product-manager", "architect", "qa-engineer"];
      const configs = topicConfigs ?? (topics ?? []).map((topic) => ({ topic }));
      if (configs.length === 0) {
        return { content: [{ type: "text", text: "Please provide topics or topicConfigs." }] };
      }

      const buildOne = async (cfg: { topic: string; agents?: string[]; appendInstruction?: string }) =>
        buildChatPrompt(
          cfg.topic,
          cfg.agents ?? agents ?? defaultAgents,
          persona,
          skills ?? [],
          [],
          4,
          maxContextChars,
          cfg.appendInstruction ?? appendInstruction
        );

      const prompts = parallel
        ? await Promise.all(configs.map(buildOne))
        : await configs.reduce(
            async (acc, cfg) => {
              const arr = await acc;
              arr.push(await buildOne(cfg));
              return arr;
            },
            Promise.resolve([] as string[])
          );

      const results = configs.map((cfg, index) => "## " + cfg.topic + "\n\n" + prompts[index]);
      const batchReport = results.join("\n\n---\n\n");

      return {
        content: [
          {
            type: "text",
            text: "# Batch Report\n\n**Topic Count**: " + configs.length + (parallel ? " (parallel)" : " (sequential)") + "\n\n" + batchReport
          }
        ]
      };
    }
  );
}

