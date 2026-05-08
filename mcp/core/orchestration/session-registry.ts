import type { OrchestrationSession } from "../types/index.js";

/**
 * In-memory orchestration session registry.
 *
 * Used as a short-lived cache during an orchestration run.
 * Durable storage is handled by SessionStore (postgres-session-store / sqlite-session-store).
 */
export interface OrchestrationSessionRegistry {
  get(sessionId: string): OrchestrationSession | undefined;
  set(session: OrchestrationSession): void;
  values(): IterableIterator<OrchestrationSession>;
  clear(): void;
  asMap(): Map<string, OrchestrationSession>;
}

export function createOrchestrationSessionRegistry(
  backingMap: Map<string, OrchestrationSession> = new Map<string, OrchestrationSession>()
): OrchestrationSessionRegistry {
  return {
    get(sessionId: string): OrchestrationSession | undefined {
      return backingMap.get(sessionId);
    },
    set(session: OrchestrationSession): void {
      backingMap.set(session.id, session);
    },
    values(): IterableIterator<OrchestrationSession> {
      return backingMap.values();
    },
    clear(): void {
      backingMap.clear();
    },
    asMap(): Map<string, OrchestrationSession> {
      return backingMap;
    }
  };
}

const defaultRegistry = createOrchestrationSessionRegistry();
export const orchestrationSessions = defaultRegistry.asMap();

/** Test helper: clear all active sessions between test cases */
export function clearOrchestrationSessionsForTest(): void {
  defaultRegistry.clear();
}

