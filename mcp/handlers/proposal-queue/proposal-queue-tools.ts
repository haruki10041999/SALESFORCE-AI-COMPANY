import {
  createProposalQueueRuntime,
  type RegisterProposalQueueToolsDeps
} from "./proposal-queue-runtime.js";
import { registerProposalQueueApplyTools } from "./proposal-queue-tools-apply.js";
import { registerProposalQueueCoreTools } from "./proposal-queue-tools-core.js";
import { registerProposalQueueStageTools } from "./proposal-queue-tools-stage.js";

export type { RegisterProposalQueueToolsDeps };

export function defineProposalQueueTools(deps: RegisterProposalQueueToolsDeps): void {
  const runtime = createProposalQueueRuntime(deps);
  registerProposalQueueCoreTools(runtime);
  registerProposalQueueStageTools(runtime);
  registerProposalQueueApplyTools(runtime);
}
