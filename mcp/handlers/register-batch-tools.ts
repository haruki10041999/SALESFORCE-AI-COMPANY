import type { RegisterGovToolDeps } from "./types.js";
import { defineBatchChatTool } from "./lightweight/batch-chat.js";

export interface RegisterBatchToolsDeps extends RegisterGovToolDeps {
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
  defineBatchChatTool(deps);
}

