import { z } from "zod";
import type { GovTool } from "@mcp/tool-types.js";
import type { ChatPreset } from "../core/types/index.js";

interface RegisterPresetToolsDeps {
  govTool: GovTool;
  createPreset: (preset: ChatPreset) => Promise<void>;
  listPresetsData: () => Promise<ChatPreset[]>;
  getPreset: (name: string) => Promise<ChatPreset | null>;
  isPresetDisabled: (presetName: string) => Promise<boolean>;
  filterDisabledSkills: (skillNames: string[]) => Promise<{ enabled: string[]; disabled: string[] }>;
  buildChatPrompt: (
    topic: string,
    agentNames: string[],
    personaName: string | undefined,
    skillNames: string[],
    filePaths: string[],
    turns: number,
    maxContextChars?: number,
    appendInstruction?: string
  ) => Promise<string>;
  emitSystemEvent: (event: string, payload: Record<string, unknown>) => Promise<void>;
}

export function registerPresetTools(deps: RegisterPresetToolsDeps): void {
  const {
    govTool,
    createPreset,
    listPresetsData,
    getPreset,
    isPresetDisabled,
    filterDisabledSkills,
    buildChatPrompt,
    emitSystemEvent
  } = deps;

  govTool(
    "create_preset",
    {
      title: "チャットプリセット作成",
      description: "新しいチャットプリセットを作成します。",
      inputSchema: {
        name: z.string(),
        description: z.string(),
        topic: z.string(),
        agents: z.array(z.string()),
        skills: z.array(z.string()).optional(),
        persona: z.string().optional(),
        filePaths: z.array(z.string()).optional(),
        triggerRules: z.array(z.object({
          whenAgent: z.string(),
          thenAgent: z.string(),
          messageIncludes: z.string().optional(),
          reason: z.string().optional(),
          once: z.boolean().optional()
        })).optional()
      }
    },
    async ({ name, description, topic, agents, skills, persona, filePaths, triggerRules }: ChatPreset) => {
      await createPreset({
        name,
        description,
        topic,
        agents,
        skills: skills ?? [],
        persona,
        filePaths,
        triggerRules
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                created: true,
                name,
                path: "outputs/presets/" + name.toLowerCase().replace(/\s+/g, "-") + ".json"
              },
              null,
              2
            )
          }
        ]
      };
    }
  );

  govTool(
    "list_presets",
    {
      title: "チャットプリセット一覧",
      description: "利用可能なチャットプリセットを一覧表示します。",
      inputSchema: {}
    },
    async () => {
      const presets = await listPresetsData();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              presets.map((p) => ({
                name: p.name,
                description: p.description,
                agents: p.agents
              })),
              null,
              2
            )
          }
        ]
      };
    }
  );

  govTool(
    "run_preset",
    {
      title: "チャットプリセット実行",
      description: "指定したチャットプリセットを実行します。",
      inputSchema: {
        name: z.string(),
        overrideTopic: z.string().optional(),
        overrideAgents: z.array(z.string()).optional(),
        additionalSkills: z.array(z.string()).optional(),
        maxContextChars: z.number().int().min(500).max(200000).optional(),
        appendInstruction: z.string().optional()
      }
    },
    async ({ name, overrideTopic, overrideAgents, additionalSkills, maxContextChars, appendInstruction }: {
      name: string;
      overrideTopic?: string;
      overrideAgents?: string[];
      additionalSkills?: string[];
      maxContextChars?: number;
      appendInstruction?: string;
    }) => {
      await emitSystemEvent("preset_before_execute", {
        presetName: name,
        overrideTopic: overrideTopic ?? null
      });

      if (await isPresetDisabled(name)) {
        return {
          content: [{ type: "text", text: "Preset is disabled: " + name }]
        };
      }

      const preset = await getPreset(name);
      if (!preset) {
        return {
          content: [{ type: "text", text: "Preset not found: " + name }]
        };
      }

      const effectiveAgents = overrideAgents ?? preset.agents;
      const effectiveSkills = [...(preset.skills ?? []), ...(additionalSkills ?? [])];
      const { enabled: enabledSkills } = await filterDisabledSkills(effectiveSkills);
      const topic = overrideTopic ?? preset.topic;
      const prompt = await buildChatPrompt(
        topic,
        effectiveAgents,
        preset.persona,
        enabledSkills,
        preset.filePaths ?? [],
        6,
        maxContextChars,
        appendInstruction
      );

      return {
        content: [
          {
            type: "text",
            text: prompt
          }
        ]
      };
    }
  );
}
