import { join, resolve } from "node:path";
import { resolveProjectRootFromFile } from "../context/markdown-catalog.js";
import { DEFAULT_SQLITE_STATE_FILE } from "../persistence/sqlite-store.js";
import { getOutputsDirStartupWarnings } from "../config/outputs-dir-warning.js";

export interface ServerRuntimePaths {
  root: string;
  outputsDir: string;
  stateDbPath: string;
  banditStateFile: string;
  startupWarnings: string[];
}

export function resolveServerRuntimePaths(importMetaUrl: string, env: NodeJS.ProcessEnv = process.env): ServerRuntimePaths {
  const root = resolveProjectRootFromFile(importMetaUrl);
  const outputsDir = env.SF_AI_OUTPUTS_DIR
    ? resolve(env.SF_AI_OUTPUTS_DIR)
    : join(root, "outputs");
  const stateDbPath = env.SF_AI_STATE_DB_PATH
    ? resolve(env.SF_AI_STATE_DB_PATH)
    : join(outputsDir, DEFAULT_SQLITE_STATE_FILE);
  const banditStateFile = join(outputsDir, "bandit-state.jsonl");

  return {
    root,
    outputsDir,
    stateDbPath,
    banditStateFile,
    startupWarnings: getOutputsDirStartupWarnings({
      root,
      outputsDirEnv: env.SF_AI_OUTPUTS_DIR,
      resolvedOutputsDir: outputsDir
    })
  };
}
