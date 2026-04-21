import { z } from "zod";

type GovTool = (name: string, config: any, handler: any) => void;

interface RegisterBatchToolsDeps {
  govTool: GovTool;
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
      title: "Batch Chat",
      description: "複数トピックを処理して統合レポートを返します。topicConfigs でトピックごとにエージェント・指示を変えることができ、parallel: true で並列実行します。",
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
        return { content: [{ type: "text", text: "topics または topicConfigs を指定してください。" }] };
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
            text: "# バッチ処理レポート\n\n**処理トピック数**: " + configs.length + (parallel ? "（並列実行）" : "（逐次実行）") + "\n\n" + batchReport
          }
        ]
      };
    }
  );
}
