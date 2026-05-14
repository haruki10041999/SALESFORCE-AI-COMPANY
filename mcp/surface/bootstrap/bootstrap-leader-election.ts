import { isEnvFlagEnabled } from "../../core/config/env-flags.js";
import { LeaderElection } from "../../core/application/reliability/leader-election.js";

export interface StartLeaderElectionBootstrapOptions {
  databaseUrl?: string;
  env?: NodeJS.ProcessEnv;
}

export function startLeaderElectionBootstrap(
  options: StartLeaderElectionBootstrapOptions
): LeaderElection {
  const env = options.env ?? process.env;
  return LeaderElection.open({
    databaseUrl: options.databaseUrl,
    enabled: isEnvFlagEnabled("SF_AI_LEADER_ELECTION_ENABLED", env, true),
    lockNamespace: "sfai:leader",
    instanceId: env.SF_AI_INSTANCE_ID
  });
}
