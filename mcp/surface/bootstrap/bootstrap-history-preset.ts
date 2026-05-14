import { join } from "node:path";
import { isEnvFlagEnabled } from "../../core/config/env-flags.js";

export interface HistoryPresetBootstrapResult {
  historyDir: string;
  presetsDir: string;
  useSqliteHistory: boolean;
  allowHistoryFileFallback: boolean;
  allowPresetFileFallback: boolean;
  historyRetentionDays: number;
  historyMaxFiles: number;
  sessionRetentionDays: number;
  ensureDir: (dir: string) => Promise<void>;
}

export function createHistoryPresetBootstrap(
  outputsDir: string,
  env: NodeJS.ProcessEnv = process.env
): HistoryPresetBootstrapResult {
  const historyDir = join(outputsDir, "history");
  const presetsDir = join(outputsDir, "presets");

  const useSqliteHistory = isEnvFlagEnabled("SF_AI_HISTORY_SQLITE", env);
  const allowHistoryFileFallback = isEnvFlagEnabled("SF_AI_HISTORY_FILE_FALLBACK", env);
  const allowPresetFileFallback = isEnvFlagEnabled("SF_AI_PRESET_FILE_FALLBACK", env);

  async function ensureDir(_dir: string): Promise<void> {
    // No-op: Postgres-backed runtime does not require filesystem directory creation.
  }

  return {
    historyDir,
    presetsDir,
    useSqliteHistory,
    allowHistoryFileFallback,
    allowPresetFileFallback,
    historyRetentionDays: 30,
    historyMaxFiles: 200,
    sessionRetentionDays: 30,
    ensureDir
  };
}
