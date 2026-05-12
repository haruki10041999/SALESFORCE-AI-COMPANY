import type { ChatPreset } from "../core/types/index.js";
import type { RegisterGovToolDeps } from "./types.js";
import { defineCreatePresetTool } from "./preset/create-preset.js";
import { defineListPresetsTool } from "./preset/list-presets.js";
import { defineRunPresetTool } from "./preset/run-preset.js";

export interface RegisterPresetToolsDeps extends RegisterGovToolDeps {
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
  defineCreatePresetTool(deps);
  defineListPresetsTool(deps);
  defineRunPresetTool(deps);
}
