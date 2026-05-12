import {
  defineProposalQueueTools,
  type RegisterProposalQueueToolsDeps
} from "./proposal-queue/proposal-queue-tools.js";

export type { RegisterProposalQueueToolsDeps };

export function registerProposalQueueTools(deps: RegisterProposalQueueToolsDeps): void {
  defineProposalQueueTools(deps);
}
