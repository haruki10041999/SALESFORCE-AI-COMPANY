export interface SessionHistoryEntry {
  agent: string;
  message: string;
}

export interface CreateSessionCompletedMemoryHookOptions {
  ingestKnowledgeSummary: (summaryText: string) => {
    entities: unknown[];
    relations: unknown[];
  };
}

export function createSessionCompletedMemoryHook(
  options: CreateSessionCompletedMemoryHookOptions
) {
  return async ({
    sessionId,
    topic,
    history
  }: {
    sessionId: string;
    topic: string;
    history: SessionHistoryEntry[];
  }): Promise<{ entities: number; relations: number } | null> => {
    if (!history || history.length === 0) {
      return null;
    }

    const lines = [
      `session: ${sessionId}`,
      `topic: ${topic}`,
      ...history.slice(-30).map((entry) => `${entry.agent}: ${entry.message}`)
    ];

    const result = options.ingestKnowledgeSummary(lines.join("\n"));
    return {
      entities: result.entities.length,
      relations: result.relations.length
    };
  };
}
