import { registerReplayTools } from "../../handlers/register-replay-tools.js";
import type { registerAllTools } from "./register-all-tools.js";

type Deps = Parameters<typeof registerAllTools>[0];

export function registerReplayDomain(deps: Deps): void {
  registerReplayTools({
    govTool: deps.govTool,
    databaseUrl: deps.databaseUrl
  });
}
