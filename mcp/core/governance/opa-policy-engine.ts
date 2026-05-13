import { promises as fsPromises } from "node:fs";
import { join, resolve } from "node:path";
import type { PolicyEngine, PolicyEngineDecision, PolicyEngineEvaluateInput } from "../ports/policy-engine.js";

type PolicyEffect = "allow" | "deny";

interface PolicyRuleCondition {
  inputPath: string;
  equals?: unknown;
  in?: unknown[];
}

interface PolicyRule {
  id: string;
  effect: PolicyEffect;
  tools?: string[];
  roles?: string[];
  tenants?: string[];
  condition?: PolicyRuleCondition;
}

interface PolicyBundle {
  version: string;
  defaultEffect: PolicyEffect;
  rules: PolicyRule[];
}

const DEFAULT_BUNDLE: PolicyBundle = {
  version: "1.0",
  defaultEffect: "allow",
  rules: []
};

export interface OpaPolicyEngineOptions {
  serverRoot: string;
  policyDir?: string;
}

function matchesPattern(value: string, pattern: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith("*")) {
    return value.startsWith(pattern.slice(0, -1));
  }
  return value === pattern;
}

function getByPath(input: unknown, path: string): unknown {
  if (!path) return undefined;
  const segments = path.split(".").filter(Boolean);
  let cursor: unknown = input;
  for (const segment of segments) {
    if (!cursor || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

function isConditionMatched(condition: PolicyRuleCondition | undefined, input: unknown): boolean {
  if (!condition) return true;
  const actual = getByPath(input, condition.inputPath);
  if (Object.prototype.hasOwnProperty.call(condition, "equals")) {
    return actual === condition.equals;
  }
  if (Array.isArray(condition.in)) {
    return condition.in.includes(actual);
  }
  return true;
}

function isRuleMatched(rule: PolicyRule, request: PolicyEngineEvaluateInput): boolean {
  if (Array.isArray(rule.tools) && rule.tools.length > 0) {
    const toolMatched = rule.tools.some((pattern) => matchesPattern(request.toolName, pattern));
    if (!toolMatched) return false;
  }
  if (Array.isArray(rule.roles) && rule.roles.length > 0) {
    const roleMatched = rule.roles.some((pattern) => matchesPattern(request.actor.role, pattern));
    if (!roleMatched) return false;
  }
  if (Array.isArray(rule.tenants) && rule.tenants.length > 0) {
    const tenant = request.actor.tenantId ?? "global";
    const tenantMatched = rule.tenants.some((pattern) => matchesPattern(tenant, pattern));
    if (!tenantMatched) return false;
  }
  return isConditionMatched(rule.condition, request.input);
}

async function loadPolicyBundle(policyDir: string, policySet: string): Promise<PolicyBundle> {
  const filePath = join(policyDir, `${policySet}.json`);
  try {
    const raw = await fsPromises.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<PolicyBundle>;
    return {
      version: typeof parsed.version === "string" ? parsed.version : DEFAULT_BUNDLE.version,
      defaultEffect: parsed.defaultEffect === "deny" ? "deny" : "allow",
      rules: Array.isArray(parsed.rules) ? parsed.rules.filter((rule): rule is PolicyRule => {
        if (!rule || typeof rule !== "object") return false;
        const casted = rule as Partial<PolicyRule>;
        return typeof casted.id === "string" && (casted.effect === "allow" || casted.effect === "deny");
      }) : []
    };
  } catch {
    return DEFAULT_BUNDLE;
  }
}

export class OpaPolicyEngine implements PolicyEngine {
  private readonly policyDir: string;

  constructor(options: OpaPolicyEngineOptions) {
    this.policyDir = resolve(options.serverRoot, options.policyDir ?? "config/policies");
  }

  async evaluate(input: PolicyEngineEvaluateInput): Promise<PolicyEngineDecision> {
    const bundle = await loadPolicyBundle(this.policyDir, input.policySet);
    for (const rule of bundle.rules) {
      if (!isRuleMatched(rule, input)) continue;
      return {
        allowed: rule.effect === "allow",
        reason: `Matched policy rule: ${rule.id}`,
        ruleId: rule.id,
        policySet: input.policySet
      };
    }

    return {
      allowed: bundle.defaultEffect === "allow",
      reason: `Default policy effect: ${bundle.defaultEffect}`,
      ruleId: "default",
      policySet: input.policySet
    };
  }
}

export function createOpaPolicyEngine(options: OpaPolicyEngineOptions): PolicyEngine {
  return new OpaPolicyEngine(options);
}
