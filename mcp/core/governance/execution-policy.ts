import { promises as fsPromises } from "node:fs";
import { resolve } from "node:path";

export interface ExecutionPolicy {
  version: string;
  blockedTools: string[];
  dangerousActions: {
    denyForNonAdmin: boolean;
    resourceActions: Array<"delete" | "disable">;
  };
}

export interface ExecutionPolicyResult {
  allowed: boolean;
  reason?: string;
  rule?: string;
}

const DEFAULT_POLICY: ExecutionPolicy = {
  version: "1.0",
  blockedTools: [],
  dangerousActions: {
    denyForNonAdmin: true,
    resourceActions: ["delete", "disable"]
  }
};

function matchesPattern(toolName: string, pattern: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith("*")) {
    const prefix = pattern.slice(0, -1);
    return toolName.startsWith(prefix);
  }
  return toolName === pattern;
}

export async function loadExecutionPolicy(outputsDir: string): Promise<ExecutionPolicy> {
  const policyPath = resolve(outputsDir, "execution-policy.json");
  try {
    const raw = await fsPromises.readFile(policyPath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<ExecutionPolicy>;
    return {
      ...DEFAULT_POLICY,
      ...parsed,
      blockedTools: Array.isArray(parsed.blockedTools) ? parsed.blockedTools : DEFAULT_POLICY.blockedTools,
      dangerousActions: {
        ...DEFAULT_POLICY.dangerousActions,
        ...(parsed.dangerousActions ?? {})
      }
    };
  } catch {
    return DEFAULT_POLICY;
  }
}

export function evaluateExecutionPolicy(params: {
  policy: ExecutionPolicy;
  toolName: string;
  role: string;
  input: unknown;
}): ExecutionPolicyResult {
  const { policy, toolName, role, input } = params;

  if (policy.blockedTools.some((pattern) => matchesPattern(toolName, pattern))) {
    return {
      allowed: false,
      reason: `Blocked tool by execution policy: ${toolName}`,
      rule: "blocked-tool"
    };
  }

  if (
    toolName === "apply_resource_actions" &&
    policy.dangerousActions.denyForNonAdmin &&
    role !== "admin"
  ) {
    const actions = extractResourceActions(input);
    const dangerous = actions.find((action) => policy.dangerousActions.resourceActions.includes(action as "delete" | "disable"));
    if (dangerous) {
      return {
        allowed: false,
        reason: `Dangerous action '${dangerous}' is denied for role=${role}`,
        rule: "dangerous-resource-action"
      };
    }
  }

  return { allowed: true };
}

function extractResourceActions(input: unknown): string[] {
  if (!input || typeof input !== "object") return [];
  const actions = (input as { actions?: unknown }).actions;
  if (!Array.isArray(actions)) return [];
  return actions
    .map((row) => (row && typeof row === "object" ? (row as { action?: unknown }).action : undefined))
    .filter((value): value is string => typeof value === "string");
}
