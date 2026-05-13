import { agentSelectionEvals } from "../../../../tests/evals/agent-selection.eval.js";
import type { EvalCase } from "../eval-harness.js";

export interface RagasAdapterDefinition {
  suiteName: string;
  cases: EvalCase[];
  baselineFile: string;
}

export class RagasAdapter {
  readonly name = "ragas";

  constructor(private readonly baselineFile: string) {}

  getDefinition(): RagasAdapterDefinition {
    return {
      suiteName: "agent-selection",
      cases: agentSelectionEvals,
      baselineFile: this.baselineFile
    };
  }
}