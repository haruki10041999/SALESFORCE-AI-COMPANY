import { z } from "zod";
import type { RegisterPresetToolsDeps } from "../register-preset-tools.js";

export function defineRunPresetTool(deps: RegisterPresetToolsDeps): void {
  const {
    govTool,
    getPreset,
    isPresetDisabled,
    filterDisabledSkills,
    buildChatPrompt,
    emitSystemEvent
  } = deps;

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
