import type { RegisterGovToolDeps } from "./types.js";
import { defineSmartChatTool } from "./lightweight/smart-chat.js";

export interface RegisterSmartChatToolsDeps extends RegisterGovToolDeps {
  root: string;
  filterDisabledSkills: (skillNames: string[]) => Promise<{ enabled: string[]; disabled: string[] }>;
  searchByKeywordAsync?: (
    query: string,
    options?: { limit?: number; minScore?: number }
  ) => Promise<Array<{ id: string; text: string; tags?: string[]; score?: number }>>;
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

export function registerSmartChatTools(deps: RegisterSmartChatToolsDeps): void {
  defineSmartChatTool(deps);
}
