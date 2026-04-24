import type { OrchestrationSession } from "../types/index.js";

/**
 * In-memory orchestration session store.
 * Extracted from server.ts to isolate mutable session state.
 */
export const orchestrationSessions = new Map<string, OrchestrationSession>();

/** Test helper: clear all active sessions between test cases */
export function clearOrchestrationSessionsForTest(): void {
  orchestrationSessions.clear();
}
