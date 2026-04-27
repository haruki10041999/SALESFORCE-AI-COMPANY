import { join } from "node:path";
import { promises as fsPromises } from "node:fs";
import { registerChatOrchestrationTools } from "../../handlers/register-chat-orchestration-tools.js";
import { registerSmartChatTools } from "../../handlers/index.js";
import { registerPresetTools } from "../../handlers/register-preset-tools.js";
import { registerVectorPromptTools } from "../../handlers/register-vector-prompt-tools.js";
import { registerBatchTools } from "../../handlers/register-batch-tools.js";
import type { registerAllTools } from "./register-all-tools.js";

type Deps = Parameters<typeof registerAllTools>[0];

/** Chat / Orchestration / Smart / Preset / Batch / Vector Prompt を登録する。 */
export function registerChatDomain(deps: Deps): void {
  const {
    govTool,
    chatInputSchema,
    triggerRuleSchema,
    runChatTool,
    generateSessionId,
    filterDisabledSkills,
    emitSystemEvent,
    buildChatPrompt,
    evaluatePseudoHooks,
    orchestrationSessions,
    saveOrchestrationSession,
    saveSessionHistory,
    restoreOrchestrationSession,
    root,
    createPreset,
    listPresetsData,
    getPreset,
    isPresetDisabled,
    addRecord,
    searchByKeyword,
    buildPrompt,
    evaluatePromptMetrics
  } = deps;

  registerChatOrchestrationTools({
    govTool,
    chatInputSchema,
    triggerRuleSchema,
    runChatTool,
    generateSessionId,
    filterDisabledSkills,
    emitSystemEvent,
    buildChatPrompt,
    evaluatePseudoHooks,
    orchestrationSessions,
    saveOrchestrationSession,
    saveSessionHistory,
    restoreOrchestrationSession,
    sessionsDir: join(root, "outputs", "sessions"),
    readDir: (path: string) => fsPromises.readdir(path),
    readFile: (path: string, encoding: BufferEncoding) => fsPromises.readFile(path, encoding)
  });

  registerSmartChatTools({
    govTool,
    root,
    filterDisabledSkills,
    buildChatPrompt
  });

  registerPresetTools({
    govTool,
    createPreset,
    listPresetsData,
    getPreset,
    isPresetDisabled,
    filterDisabledSkills,
    buildChatPrompt,
    emitSystemEvent
  });

  registerVectorPromptTools({
    govTool,
    addRecord,
    searchByKeyword,
    buildPrompt,
    evaluatePromptMetrics
  });

  registerBatchTools({
    govTool,
    buildChatPrompt
  });
}
