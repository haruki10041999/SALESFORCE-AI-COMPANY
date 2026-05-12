import type { OrchestrationSession } from "../../../types/index.js";
import type { SessionStore } from "../../../persistence/session-store.js";
import type { OrchestrationQueueStore } from "../../../orchestration/orchestration-queue-store.js";

export async function executeGetSessionOrRestore(args: {
  sessionId: string;
  sessionStore: SessionStore;
  orchestrationQueueStore: OrchestrationQueueStore;
  liveSessionCache: Map<string, OrchestrationSession>;
}): Promise<OrchestrationSession | undefined> {
  const { sessionId, sessionStore, orchestrationQueueStore, liveSessionCache } = args;

  const cached = liveSessionCache.get(sessionId);
  if (cached) {
    return cached;
  }
  const fromStore = await sessionStore.getById(sessionId);
  if (fromStore) {
    await orchestrationQueueStore.replace(sessionId, fromStore.queue);
    liveSessionCache.set(sessionId, fromStore);
  }
  return fromStore ?? undefined;
}
