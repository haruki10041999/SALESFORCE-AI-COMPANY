import { join } from "node:path";
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
    sessionStore,
    orchestrationQueueStore,
    orchestrationJobRunner,
    policySnapshotManager,
    saveSessionHistory,
    onSessionCompleted,
    root,
    createPreset,
    listPresetsData,
    getPreset,
    isPresetDisabled,
    addRecord,
    searchByKeyword,
    searchByKeywordAsync,
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
    sessionStore,
    orchestrationQueueStore,
    orchestrationJobRunner,
    policySnapshotManager,
    saveSessionHistory,
    onSessionCompleted,
    outputsDir: join(root, "outputs")
  });

  registerSmartChatTools({
    govTool,
    root,
    filterDisabledSkills,
    ...(searchByKeywordAsync ? { searchByKeywordAsync } : {}),
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
    ...(searchByKeywordAsync ? { searchByKeywordAsync } : {}),
    buildPrompt,
    evaluatePromptMetrics
  });

  registerBatchTools({
    govTool,
    buildChatPrompt
  });
}
