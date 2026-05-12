import {
  buildAgentReputationSnapshot,
  loadAgentReputationRecords,
  updateAgentReputation
} from "../../../learning/agent-reputation.js";

export interface ReputationScopeSelectionInput {
  topic?: string;
  org?: string;
  user?: string;
  updateGlobal?: boolean;
}

export interface ReputationScopeSelection {
  scope: "global" | "topic" | "org" | "user";
  scopeKey?: string;
}

export function buildReputationScopeSelections(input: ReputationScopeSelectionInput): ReputationScopeSelection[] {
  const selections: ReputationScopeSelection[] = [];
  if (input.updateGlobal !== false) {
    selections.push({ scope: "global", scopeKey: "global" });
  }
  if (input.topic && input.topic.trim().length > 0) {
    selections.push({ scope: "topic", scopeKey: input.topic.trim() });
  }
  if (input.org && input.org.trim().length > 0) {
    selections.push({ scope: "org", scopeKey: input.org.trim() });
  }
  if (input.user && input.user.trim().length > 0) {
    selections.push({ scope: "user", scopeKey: input.user.trim() });
  }
  return selections;
}

export function buildUpdateAgentReputationResponse(args: {
  agentName: string;
  records: unknown[];
  snapshot: unknown;
  filePath: string;
}): Record<string, unknown> {
  return {
    updated: true,
    agentName: args.agentName,
    updateCount: args.records.length,
    records: args.records,
    snapshot: args.snapshot,
    filePath: args.filePath
  };
}

export function buildGetAgentReputationResponse(args: {
  agentName: string;
  topic?: string;
  org?: string;
  user?: string;
  snapshot: unknown;
  records: Array<{ agentName: string }>;
  filePath: string;
}): Record<string, unknown> {
  return {
    agentName: args.agentName,
    context: {
      topic: args.topic ?? null,
      org: args.org ?? null,
      user: args.user ?? null
    },
    snapshot: args.snapshot,
    recordCount: args.records.filter((row) => row.agentName === args.agentName).length,
    filePath: args.filePath
  };
}

export async function executeUpdateAgentReputation(args: {
  agentName: string;
  delta: number;
  reason?: string;
  topic?: string;
  org?: string;
  user?: string;
  updateGlobal?: boolean;
  agentReputationFile: string;
}): Promise<Record<string, unknown>> {
  const scopes = buildReputationScopeSelections({
    topic: args.topic,
    org: args.org,
    user: args.user,
    updateGlobal: args.updateGlobal
  });

  const recorded = [];
  for (const scope of scopes) {
    recorded.push(await updateAgentReputation({
      agentName: args.agentName,
      scope: scope.scope,
      scopeKey: scope.scopeKey,
      delta: args.delta,
      reason: args.reason,
      filePath: args.agentReputationFile
    }));
  }

  const allRecords = await loadAgentReputationRecords(args.agentReputationFile);
  const snapshot = buildAgentReputationSnapshot(allRecords, {
    agentName: args.agentName,
    topic: args.topic,
    org: args.org,
    user: args.user
  });

  return buildUpdateAgentReputationResponse({
    agentName: args.agentName,
    records: recorded,
    snapshot,
    filePath: args.agentReputationFile
  });
}

export async function executeGetAgentReputation(args: {
  agentName: string;
  topic?: string;
  org?: string;
  user?: string;
  agentReputationFile: string;
}): Promise<Record<string, unknown>> {
  const records = await loadAgentReputationRecords(args.agentReputationFile);
  const snapshot = buildAgentReputationSnapshot(records, {
    agentName: args.agentName,
    topic: args.topic,
    org: args.org,
    user: args.user
  });

  return buildGetAgentReputationResponse({
    agentName: args.agentName,
    topic: args.topic,
    org: args.org,
    user: args.user,
    snapshot,
    records,
    filePath: args.agentReputationFile
  });
}
