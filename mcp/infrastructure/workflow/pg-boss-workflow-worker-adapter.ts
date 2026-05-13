import { PgBoss } from "pg-boss";
import type { WorkflowEngine } from "../../core/ports/workflow-engine.js";

export interface PgBossWorkflowWorkerAdapterOptions {
  databaseUrl: string;
  queueName?: string;
  workflowEngine: WorkflowEngine;
}

export interface PgBossWorkflowWorkerAdapter {
  close(): Promise<void>;
}

export async function createPgBossWorkflowWorkerAdapter(
  options: PgBossWorkflowWorkerAdapterOptions
): Promise<PgBossWorkflowWorkerAdapter> {
  const boss = new PgBoss(options.databaseUrl);
  const queueName = options.queueName ?? "workflow-steps";
  await boss.start();
  await boss.createQueue(queueName).catch(() => {
    // Queue may already exist.
  });

  await boss.work(queueName, async (jobs) => {
    const job = jobs[0];
    if (!job) {
      return;
    }

    const data = job.data as {
      kind?: "signal" | "retry";
      input?: Record<string, unknown>;
    } | undefined;
    if (!data?.kind || !data.input) {
      return;
    }

    if (data.kind === "signal") {
      await options.workflowEngine.signal({
        sessionId: String(data.input.sessionId ?? ""),
        agent: String(data.input.agent ?? ""),
        payload: data.input.payload,
        checkpoint: data.input.checkpoint as Record<string, unknown> | undefined
      });
      return;
    }

    await options.workflowEngine.retry({
      sessionId: String(data.input.sessionId ?? ""),
      agent: String(data.input.agent ?? ""),
      reason: typeof data.input.reason === "string" ? data.input.reason : undefined,
      payload: data.input.payload,
      checkpoint: data.input.checkpoint as Record<string, unknown> | undefined
    });
  });

  return {
    async close(): Promise<void> {
      await boss.stop();
    }
  };
}