import { promises as fsPromises } from "node:fs";
import { resolve } from "node:path";

export interface RbacRolePolicy {
  allow: string[];
  deny?: string[];
}

export interface RbacPolicy {
  version: string;
  defaultRole: string;
  roles: Record<string, RbacRolePolicy>;
}

export interface RbacAccessResult {
  allowed: boolean;
  role: string;
  reason?: string;
}

const DEFAULT_POLICY: RbacPolicy = {
  version: "1.0",
  defaultRole: "admin",
  roles: {
    admin: {
      allow: ["*"]
    },
    operator: {
      allow: [
        "health_check",
        "get_system_events",
        "get_handlers_dashboard",
        "export_handlers_statistics",
        "analyze_ab_test_history",
        "evaluate_cost_sla",
        "estimate_prompt_cost"
      ],
      deny: ["update_event_automation_config"]
    },
    viewer: {
      allow: [
        "health_check",
        "get_system_events",
        "get_handlers_dashboard",
        "analyze_ab_test_history"
      ]
    }
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

function hasMatch(toolName: string, patterns: string[] | undefined): boolean {
  if (!patterns || patterns.length === 0) return false;
  return patterns.some((pattern) => matchesPattern(toolName, pattern));
}

export async function loadRbacPolicy(outputsDir: string): Promise<RbacPolicy> {
  const policyPath = resolve(outputsDir, "rbac-policy.json");
  try {
    const raw = await fsPromises.readFile(policyPath, "utf-8");
    const parsed = JSON.parse(raw) as RbacPolicy;
    if (!parsed.roles || typeof parsed.roles !== "object") {
      return DEFAULT_POLICY;
    }
    return parsed;
  } catch {
    return DEFAULT_POLICY;
  }
}

export function evaluateRbacAccess(policy: RbacPolicy, toolName: string, roleFromEnv?: string): RbacAccessResult {
  const role = roleFromEnv || process.env.SF_AI_ROLE || policy.defaultRole || "admin";
  const rolePolicy = policy.roles[role];
  if (!rolePolicy) {
    return {
      allowed: false,
      role,
      reason: `Unknown role: ${role}`
    };
  }

  if (hasMatch(toolName, rolePolicy.deny)) {
    return {
      allowed: false,
      role,
      reason: `Denied by RBAC policy (role=${role})`
    };
  }

  if (!hasMatch(toolName, rolePolicy.allow)) {
    return {
      allowed: false,
      role,
      reason: `Tool not allowed for role=${role}`
    };
  }

  return {
    allowed: true,
    role
  };
}

export async function checkToolAccess(outputsDir: string, toolName: string, roleFromEnv?: string): Promise<RbacAccessResult> {
  const policy = await loadRbacPolicy(outputsDir);
  return evaluateRbacAccess(policy, toolName, roleFromEnv);
}
