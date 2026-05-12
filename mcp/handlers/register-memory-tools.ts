import type { RegisterGovToolDeps } from "./types.js";
import { defineAddMemoryTool } from "./memory/add-memory.js";
import { defineSearchMemoryTool } from "./memory/search-memory.js";
import { defineListMemoryTool } from "./memory/list-memory.js";
import { defineClearMemoryTool } from "./memory/clear-memory.js";
import { defineRecordFailureTool } from "./memory/record-failure.js";
import { defineSearchFailuresTool } from "./memory/search-failures.js";
import { defineListFailuresTool } from "./memory/list-failures.js";

export interface RegisterMemoryToolsDeps extends RegisterGovToolDeps {
  addMemory: (text: string) => Promise<void>;
  searchMemory: (query: string) => Promise<string[]>;
  listMemory: () => Promise<string[]>;
  clearMemory: () => Promise<void>;
  recordFailureMemory: (input: {
    pattern: string;
    reason: string;
    preventiveAction: string;
    tags?: string[];
  }) => Promise<{
    pattern: string;
    reason: string;
    preventiveAction: string;
    tags: string[];
    recordedAt: string;
  }>;
  searchFailureMemory: (query: string, limit?: number) => Promise<Array<{
    pattern: string;
    reason: string;
    preventiveAction: string;
    tags: string[];
    recordedAt: string;
  }>>;
  listFailureMemory: (limit?: number) => Promise<Array<{
    pattern: string;
    reason: string;
    preventiveAction: string;
    tags: string[];
    recordedAt: string;
  }>>;
}

export function registerMemoryTools(deps: RegisterMemoryToolsDeps): void {
  defineAddMemoryTool(deps);
  defineSearchMemoryTool(deps);
  defineListMemoryTool(deps);
  defineClearMemoryTool(deps);
  defineRecordFailureTool(deps);
  defineSearchFailuresTool(deps);
  defineListFailuresTool(deps);
}
