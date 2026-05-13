import { Worker } from "@temporalio/worker";
import { fileURLToPath } from "node:url";
import { NativeConnection } from "@temporalio/worker";
import type { TemporalWorkflowActivities } from "./temporal-workflow-activities.js";

export interface CreateTemporalWorkflowWorkerOptions {
  temporalAddress?: string;
  temporalNamespace?: string;
  taskQueue?: string;
  workflowsPath?: string;
  activities?: TemporalWorkflowActivities;
}

export interface TemporalWorkflowWorkerHandle {
  runPromise: Promise<void>;
  close(): Promise<void>;
}

export async function createTemporalWorkflowWorker(
  options: CreateTemporalWorkflowWorkerOptions = {}
): Promise<TemporalWorkflowWorkerHandle> {
  const temporalAddress = options.temporalAddress ?? "localhost:7233";
  const temporalNamespace = options.temporalNamespace ?? "default";
  const taskQueue = options.taskQueue ?? "sfai-orchestration";
  const workflowsPath =
    options.workflowsPath ??
    fileURLToPath(new URL("./temporal-orchestrate-chat.workflow.ts", import.meta.url));

  const connection = await NativeConnection.connect({ address: temporalAddress });

  const worker = await Worker.create({
    connection,
    namespace: temporalNamespace,
    taskQueue,
    workflowsPath,
    activities: options.activities
  });

  const runPromise = worker.run();

  return {
    runPromise,
    async close(): Promise<void> {
      worker.shutdown();
      await runPromise;
      await connection.close();
    }
  };
}
