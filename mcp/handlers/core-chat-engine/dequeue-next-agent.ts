import { z } from "zod";
import { join } from "node:path";
import type { RegisterGovToolDeps } from "../types.js";
import {
  executeDequeueNextAgentTool
} from "../../core/application/chat/services/chat-orchestration-dequeue-tool.js";
import { buildSessionNotFoundText } from "../../core/application/chat/services/chat-orchestration-responses.js";
import type { SessionStore } from "../../core/persistence/session-store.js";
import type { OrchestrationQueueStore } from "../../core/orchestration/orchestration-queue-store.js";
import type { OrchestrationJobRunner } from "../../core/orchestration/job-runner.js";
import type { PolicySnapshotManager } from "../../core/learning/policy-snapshot.js";

export interface DefineDequeueNextAgentDeps extends RegisterGovToolDeps {
  sessionStore: SessionStore;
  orchestrationQueueStore: OrchestrationQueueStore;
  orchestrationJobRunner: OrchestrationJobRunner;
  policySnapshotManager?: PolicySnapshotManager;
  saveSessionHistory: (topic: string, entries: any[]) => Promise<string>;
  onSessionCompleted?: (input: {
    sessionId: string;
    topic: string;
    history: any[];
  }) => Promise<{ entities: number; relations: number } | null>;
  outputsDir: string;
  liveSessionCache: Map<string, any>;
  emitSystemEvent: (event: string, payload: Record<string, unknown>) => Promise<void>;
}

export function defineDequeueNextAgentTool(deps: DefineDequeueNextAgentDeps): void {
  const {
    govTool,
    sessionStore,
    orchestrationQueueStore,
    orchestrationJobRunner,
    policySnapshotManager,
    saveSessionHistory,
    onSessionCompleted,
    outputsDir,
    liveSessionCache,
    emitSystemEvent
  } = deps;

  const agentGraphFile = join(outputsDir, "agent-graph.jsonl");
  const agentReputationFile = join(outputsDir, "agent-reputation.jsonl");

  govTool(
    "dequeue_next_agent",
    {
      title: "次エージェント取り出し",
      description: "セッションキューから次に実行するエージェントを取得します。",
      inputSchema: {
        sessionId: z.string(),
        limit: z.number().int().min(1).max(10).optional()
      }
    },
    async ({ sessionId, limit }: { sessionId: string; limit?: number }) => {
      const result = await executeDequeueNextAgentTool({
        sessionId,
        limit,
        liveSessionCache,
        sessionStore,
        orchestrationQueueStore: {
          replace: (targetSessionId, queue) => orchestrationQueueStore.replace(targetSessionId, queue),
          dequeue: (targetSessionId, take) => orchestrationQueueStore.dequeue(targetSessionId, take),
          clear: (targetSessionId) => orchestrationQueueStore.clear(targetSessionId)
        },
        orchestrationJobRunner: {
          markDequeued: (targetSessionId, agent) => orchestrationJobRunner.markDequeued(targetSessionId, agent),
          completeLatestRunningStep: (input) => orchestrationJobRunner.completeLatestRunningStep(input)
        },
        policySnapshotManager,
        agentGraphFile,
        agentReputationFile,
        buildSessionNotFoundText,
        saveSessionHistory,
        onSessionCompleted,
        emitSystemEvent
      });

      if (result.notFoundText) {
        return {
          content: [{ type: "text", text: result.notFoundText }]
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(result.response ?? {}, null, 2) }]
      };
    }
  );
}
