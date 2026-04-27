import {
  registerLoggingTools,
  registerHistoryTools,
  registerExportTools,
  registerMemoryTools,
  registerContextTools
} from "../../handlers/index.js";
import type { registerAllTools } from "./register-all-tools.js";

type Deps = Parameters<typeof registerAllTools>[0];

/** Logging / History / Memory / Context / Export を登録する。 */
export function registerHistoryContextDomain(deps: Deps): void {
  const {
    govTool,
    agentLog,
    loadSystemEvents,
    loadGovernanceState,
    saveGovernanceState,
    buildDefaultGovernanceState,
    normalizeProtectedTools,
    saveChatHistory,
    emitSystemEvent,
    loadChatHistories,
    restoreChatHistory,
    ensureDir,
    addMemory,
    searchMemory,
    listMemory,
    clearMemory,
    root,
    findMdFilesRecursive,
    toPosixPath
  } = deps;

  registerLoggingTools({
    govTool,
    agentLog,
    loadSystemEvents,
    loadGovernanceState,
    saveGovernanceState,
    buildDefaultGovernanceState,
    normalizeProtectedTools,
    saveChatHistory,
    emitSystemEvent
  });

  registerHistoryTools({
    govTool,
    agentLog,
    saveChatHistory,
    loadChatHistories,
    restoreChatHistory,
    emitSystemEvent
  });

  registerExportTools({
    govTool,
    agentLog,
    loadChatHistories,
    ensureDir
  });

  registerMemoryTools({
    govTool,
    addMemory,
    searchMemory,
    listMemory,
    clearMemory
  });

  registerContextTools({
    govTool,
    root,
    findMdFilesRecursive,
    toPosixPath
  });
}
