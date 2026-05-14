import {
  createPresetStore,
  createHistoryStore,
  PostgresSessionStore,
  SqliteSessionStore,
  type SessionStore
} from "../../core/application/history/bootstrap-adapters.js";
import { createHistoryPresetBootstrap } from "./bootstrap-history-preset.js";

export interface AgentMessage {
  agent: string;
  message: string;
  timestamp: string;
  topic?: string;
}

export interface StartPresetsHistoryBootstrapOptions {
  outputsDir: string;
  stateDbPath: string;
  stateBackend: "sqlite" | "postgres";
  databaseUrl?: string;
  agentLog: AgentMessage[];
  env?: NodeJS.ProcessEnv;
}

export interface PresetsHistoryBootstrapResult {
  presetsDir: string;
  ensureDir: (dir: string) => Promise<void>;
  createPreset: ReturnType<typeof createPresetStore>["createPreset"];
  listPresetsData: ReturnType<typeof createPresetStore>["listPresetsData"];
  getPreset: ReturnType<typeof createPresetStore>["getPreset"];
  saveChatHistory: ReturnType<typeof createHistoryStore>["saveChatHistory"];
  saveSessionHistory: ReturnType<typeof createHistoryStore>["saveSessionHistory"];
  loadChatHistories: ReturnType<typeof createHistoryStore>["loadChatHistories"];
  restoreChatHistory: ReturnType<typeof createHistoryStore>["restoreChatHistory"];
  sessionStore: SessionStore;
}

export async function startPresetsHistoryBootstrap(
  options: StartPresetsHistoryBootstrapOptions
): Promise<PresetsHistoryBootstrapResult> {
  const env = options.env ?? process.env;
  const historyPresetBootstrap = createHistoryPresetBootstrap(options.outputsDir, env);

  const { createPreset, listPresetsData, getPreset } = createPresetStore({
    presetsDir: historyPresetBootstrap.presetsDir,
    ensureDir: historyPresetBootstrap.ensureDir,
    allowFileFallback: historyPresetBootstrap.allowPresetFileFallback
  });

  const { saveChatHistory, saveSessionHistory, loadChatHistories, restoreChatHistory } = createHistoryStore({
    historyDir: historyPresetBootstrap.historyDir,
    ensureDir: historyPresetBootstrap.ensureDir,
    agentLog: options.agentLog,
    maxHistoryFiles: historyPresetBootstrap.historyMaxFiles,
    retentionDays: historyPresetBootstrap.historyRetentionDays,
    allowFileFallback: historyPresetBootstrap.allowHistoryFileFallback,
    sqlite: {
      enabled: historyPresetBootstrap.useSqliteHistory,
      dbPath: options.stateDbPath
    }
  });

  const sessionStore: SessionStore = options.stateBackend === "postgres" && options.databaseUrl
    ? await PostgresSessionStore.open({
        databaseUrl: options.databaseUrl,
        retentionDays: historyPresetBootstrap.sessionRetentionDays
      })
    : SqliteSessionStore.open({
        dbPath: options.stateDbPath,
        retentionDays: historyPresetBootstrap.sessionRetentionDays
      });

  return {
    presetsDir: historyPresetBootstrap.presetsDir,
    ensureDir: historyPresetBootstrap.ensureDir,
    createPreset,
    listPresetsData,
    getPreset,
    saveChatHistory,
    saveSessionHistory,
    loadChatHistories,
    restoreChatHistory,
    sessionStore
  };
}
