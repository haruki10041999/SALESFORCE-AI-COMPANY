import type { TemporalWorkflowWorkerHandle } from "../../infrastructure/workflow/temporal-workflow-worker.js";

interface WorkflowBootstrapLogger {
  info(message: string): void;
  warn(message: string): void;
}

export interface StartTemporalWorkerBootstrapOptions {
  workflowMode: "in-process" | "temporal";
  runWorkerEnabled: boolean;
  logger: WorkflowBootstrapLogger;
  createWorker: () => Promise<TemporalWorkflowWorkerHandle>;
  summarizeError: (error: unknown) => string;
}

export async function startTemporalWorkerBootstrap(
  options: StartTemporalWorkerBootstrapOptions
): Promise<TemporalWorkflowWorkerHandle | null> {
  if (options.workflowMode !== "temporal" || !options.runWorkerEnabled) {
    return null;
  }

  try {
    const worker = await options.createWorker();
    options.logger.info("Temporal workflow worker started");
    return worker;
  } catch (error) {
    options.logger.warn(`Temporal workflow worker startup failed: ${options.summarizeError(error)}`);
    return null;
  }
}
