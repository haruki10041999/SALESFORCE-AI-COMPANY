import type { SagaDefinition, SagaStep } from "../../core/ports/saga.js";

export interface SagaFailure {
  step: string;
  error: unknown;
}

export interface SagaExecutionResult {
  status: "completed" | "compensated";
  completedSteps: string[];
  compensatedSteps: string[];
  failure?: SagaFailure;
  compensationFailures: SagaFailure[];
}

export interface RunSagaOptions<TContext> {
  saga: SagaDefinition<TContext>;
  context: TContext;
  onEvent?: (event: {
    phase: "do:start" | "do:done" | "do:failed" | "undo:start" | "undo:done" | "undo:failed";
    step: string;
    error?: unknown;
  }) => void;
}

export async function runSaga<TContext>(options: RunSagaOptions<TContext>): Promise<SagaExecutionResult> {
  const completed: SagaStep<TContext>[] = [];
  const completedStepNames: string[] = [];
  const compensatedStepNames: string[] = [];
  const compensationFailures: SagaFailure[] = [];

  for (const step of options.saga.steps) {
    options.onEvent?.({ phase: "do:start", step: step.name });
    try {
      await step.do(options.context);
      completed.push(step);
      completedStepNames.push(step.name);
      options.onEvent?.({ phase: "do:done", step: step.name });
    } catch (error) {
      options.onEvent?.({ phase: "do:failed", step: step.name, error });

      for (const doneStep of [...completed].reverse()) {
        if (!doneStep.undo) {
          continue;
        }

        options.onEvent?.({ phase: "undo:start", step: doneStep.name });
        try {
          await doneStep.undo(options.context);
          compensatedStepNames.push(doneStep.name);
          options.onEvent?.({ phase: "undo:done", step: doneStep.name });
        } catch (undoError) {
          compensationFailures.push({ step: doneStep.name, error: undoError });
          options.onEvent?.({ phase: "undo:failed", step: doneStep.name, error: undoError });
        }
      }

      return {
        status: "compensated",
        completedSteps: completedStepNames,
        compensatedSteps: compensatedStepNames,
        failure: {
          step: step.name,
          error
        },
        compensationFailures
      };
    }
  }

  return {
    status: "completed",
    completedSteps: completedStepNames,
    compensatedSteps: compensatedStepNames,
    compensationFailures
  };
}
