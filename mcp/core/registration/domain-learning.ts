import { registerLearningTools } from "../../handlers/register-learning-tools.js";
import type { registerAllTools } from "./register-all-tools.js";

type Deps = Parameters<typeof registerAllTools>[0];

export function registerLearningDomain(deps: Deps): void {
  registerLearningTools({
    govTool: deps.govTool,
    proposalQueue: deps.proposalQueue,
    databaseUrl: deps.databaseUrl
  });
}
