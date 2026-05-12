import { z } from "zod";
import { isEnvFlagEnabled } from "../../core/config/env-flags.js";
import type { ChatPreset } from "../../core/types/index.js";
import type { RegisterPresetToolsDeps } from "../register-preset-tools.js";

export function defineCreatePresetTool(deps: RegisterPresetToolsDeps): void {
  const { govTool, createPreset } = deps;
  const presetFileFallbackEnabled = isEnvFlagEnabled("SF_AI_PRESET_FILE_FALLBACK");

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
                path: presetFileFallbackEnabled
                  ? "outputs/presets/" + name.toLowerCase().replace(/\s+/g, "-") + ".json"
                  : "store://presets/" + name.toLowerCase().replace(/\s+/g, "-")
              },
              null,
              2
            )
          }
        ]
      };
    }
  );
}
