export interface SagaStep<TContext> {
  name: string;
  do: (context: TContext) => Promise<void> | void;
  undo?: (context: TContext) => Promise<void> | void;
}

export interface SagaDefinition<TContext> {
  name: string;
  steps: SagaStep<TContext>[];
}

export function defineSaga<TContext>(definition: SagaDefinition<TContext>): SagaDefinition<TContext> {
  return definition;
}
