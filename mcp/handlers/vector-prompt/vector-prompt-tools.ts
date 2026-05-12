import { isEnvFlagEnabled } from "../../core/config/env-flags.js";
import { createLogger } from "../../core/logging/logger.js";
import type { RegisterVectorPromptToolsDeps } from "../register-vector-prompt-tools.js";
import { registerVectorPromptCoreTools } from "./vector-prompt-tools-core.js";
import { registerVectorPromptQualityTools } from "./vector-prompt-tools-quality.js";

export interface VectorPromptLogging {
  debug: (message: string, payload?: Record<string, unknown>) => void;
}

export function defineVectorPromptTools(deps: RegisterVectorPromptToolsDeps): void {
  const logger = createLogger("VectorPromptTools");
  const verbosePromptDebug = isEnvFlagEnabled("SF_AI_DEBUG_VERBOSE_PROMPT");
  registerVectorPromptCoreTools(deps, logger, verbosePromptDebug);
  registerVectorPromptQualityTools(deps, logger);
}
