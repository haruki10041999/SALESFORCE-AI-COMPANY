import { promises as fsPromises } from "node:fs";
import { resolve } from "node:path";
import type { ActorIdentity } from "./actor.js";

export type RbacEffect = "allow" | "deny";

export interface RbacRule {
  role: string;
  resource: string;
  action: string;
  effect: RbacEffect;
}

export interface RbacPolicy {
  version: string;
  defaultRole: string;
  rules: RbacRule[];
}

export interface AuthorizationResult {
  allowed: boolean;
  role: string;
  reason?: string;
}

const DEFAULT_POLICY: RbacPolicy = {
  version: "1.0",
  defaultRole: "admin",
  rules: [{ role: "admin", resource: "*", action: "*", effect: "allow" }]
};

function matchPattern(value: string, pattern: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith("*")) {
    return value.startsWith(pattern.slice(0, -1));
  }
  return value === pattern;
}

function normalizeRule(input: Partial<RbacRule>): RbacRule | null {
  if (!input.role || !input.resource || !input.action) {
    return null;
  }
  const effect = input.effect === "deny" ? "deny" : "allow";
  return {
    role: String(input.role).trim(),
    resource: String(input.resource).trim(),
    action: String(input.action).trim(),
    effect
  };
}

function parseYamlLikePolicy(raw: string): RbacPolicy {
  // roles.yaml is stored as JSON text, which is valid YAML as well.
  const parsed = JSON.parse(raw) as Partial<RbacPolicy>;
  const rules = Array.isArray(parsed.rules)
    ? parsed.rules
      .map((rule) => normalizeRule(rule as Partial<RbacRule>))
      .filter((rule): rule is RbacRule => rule !== null)
    : [];
  if (rules.length === 0) {
    return DEFAULT_POLICY;
  }
  return {
    version: typeof parsed.version === "string" ? parsed.version : "1.0",
    defaultRole: typeof parsed.defaultRole === "string" && parsed.defaultRole.trim().length > 0
      ? parsed.defaultRole
      : "viewer",
    rules
  };
}

export async function loadRbacPolicy(rootDir = process.cwd()): Promise<RbacPolicy> {
  const policyPath = resolve(rootDir, "config/rbac/roles.yaml");
  try {
    const raw = await fsPromises.readFile(policyPath, "utf-8");
    return parseYamlLikePolicy(raw);
  } catch {
    return DEFAULT_POLICY;
  }
}

export function authorize(
  policy: RbacPolicy,
  role: string | undefined,
  action: string,
  resource: string
): AuthorizationResult {
  const effectiveRole = (role ?? policy.defaultRole ?? "viewer").trim() || "viewer";
  const matched = policy.rules.filter(
    (rule) => rule.role === effectiveRole && matchPattern(resource, rule.resource) && matchPattern(action, rule.action)
  );
  if (matched.some((rule) => rule.effect === "deny")) {
    return {
      allowed: false,
      role: effectiveRole,
      reason: `Denied by RBAC policy (role=${effectiveRole}, action=${action}, resource=${resource})`
    };
  }
  if (matched.some((rule) => rule.effect === "allow")) {
    return { allowed: true, role: effectiveRole };
  }
  return {
    allowed: false,
    role: effectiveRole,
    reason: `No matching RBAC allow rule (role=${effectiveRole}, action=${action}, resource=${resource})`
  };
}

export async function authorizeToolExecution(
  actor: ActorIdentity,
  toolName: string,
  rootDir = process.cwd()
): Promise<AuthorizationResult> {
  const policy = await loadRbacPolicy(rootDir);
  return authorize(policy, actor.role, "execute", `tool:${toolName}`);
}
