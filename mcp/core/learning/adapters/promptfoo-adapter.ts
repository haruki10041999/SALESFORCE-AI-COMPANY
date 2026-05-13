import { promptTemplateEvals } from "../../../../tests/evals/prompt-templates.eval.js";
import type { EvalCase } from "../eval-harness.js";

export interface PromptfooAdapterDefinition {
  suiteName: string;
  cases: EvalCase[];
  baselineFile: string;
}

export class PromptfooAdapter {
  readonly name = "promptfoo";

  constructor(private readonly baselineFile: string) {}

  getDefinition(): PromptfooAdapterDefinition {
    return {
      suiteName: "prompt-templates",
      cases: promptTemplateEvals,
      baselineFile: this.baselineFile
    };
  }
}