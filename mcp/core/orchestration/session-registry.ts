import type { OrchestrationSession } from "../types/index.js";

/**
 * In-memory orchestration session registry.
 *
 * Keep default Map-based behavior, but expose a factory so runtime can
 * swap to another registry implementation if needed.
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
