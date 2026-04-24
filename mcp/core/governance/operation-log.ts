import { existsSync, promises as fsPromises } from "fs";
import { dirname } from "path";
import type { ResourceOperation } from "./governance-manager.js";
import { maskUnknown } from "../logging/pii-masker.js";

export interface OperationLogDeps {
  logFile: string;
  ensureDir: (dir: string) => Promise<void>;
}

export function createOperationLog(deps: OperationLogDeps) {
  const { logFile, ensureDir } = deps;

  async function loadRecentOperations(): Promise<ResourceOperation[]> {
    if (!existsSync(logFile)) return [];
    const lines = (await fsPromises.readFile(logFile, "utf-8"))
      .split("\n")
      .filter((l) => l.trim());
    return lines
      .map((l) => {
        try {
          return JSON.parse(l) as ResourceOperation;
        } catch {
          return null;
        }
      })
      .filter((x): x is ResourceOperation => x !== null);
  }

  async function appendOperationLog(op: ResourceOperation): Promise<void> {
    await ensureDir(dirname(logFile));
    await fsPromises.appendFile(logFile, JSON.stringify(maskUnknown(op)) + "\n", "utf-8");
  }

  return { loadRecentOperations, appendOperationLog };
}
