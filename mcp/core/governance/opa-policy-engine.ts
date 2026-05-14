import { promises as fsPromises } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { createHash, createPublicKey, verify } from "node:crypto";
import type { PolicyEngine, PolicyEngineDecision, PolicyEngineEvaluateInput } from "../ports/policy-engine.js";
import { createLogger } from "../logging/logger.js";

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

interface PolicyBundleEnvelope {
  version?: string;
  generatedAt?: string;
  policySets?: Record<string, Partial<PolicyBundle>>;
}

const DEFAULT_BUNDLE: PolicyBundle = {
  version: "1.0",
  defaultEffect: "allow",
  rules: []
};

export interface OpaPolicyEngineOptions {
  serverRoot: string;
  policyDir?: string;
  policyBundlePublicKeyPath?: string;
  onPolicyBundleFallback?: (reason: string, context: { policySet: string }) => void;
}

interface LoadPolicyBundleResult {
  bundle: PolicyBundle;
  source: "bundle" | "policy-file" | "default";
  fallbackReason?: string;
}

const logger = createLogger("OpaPolicyEngine");

function resolveMaybeAbsolute(serverRoot: string, target: string): string {
  return isAbsolute(target) ? target : resolve(serverRoot, target);
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

function normalizePolicyBundle(parsed: Partial<PolicyBundle> | undefined): PolicyBundle {
  return {
    version: typeof parsed?.version === "string" ? parsed.version : DEFAULT_BUNDLE.version,
    defaultEffect: parsed?.defaultEffect === "deny" ? "deny" : "allow",
    rules: Array.isArray(parsed?.rules) ? parsed.rules.filter((rule): rule is PolicyRule => {
      if (!rule || typeof rule !== "object") return false;
      const casted = rule as Partial<PolicyRule>;
      return typeof casted.id === "string" && (casted.effect === "allow" || casted.effect === "deny");
    }) : []
  };
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function verifyPolicyBundleSignature(policyDir: string, bundleRaw: string, publicKeyPath: string): Promise<boolean> {
  try {
    const publicKeyPem = await fsPromises.readFile(publicKeyPath, "utf-8");
    const signatureRaw = (await fsPromises.readFile(join(policyDir, "policy-bundle.sig"), "utf-8")).trim();
    if (!signatureRaw) {
      return false;
    }
    const signature = Buffer.from(signatureRaw, "base64");
    return verify(null, Buffer.from(bundleRaw, "utf-8"), createPublicKey(publicKeyPem), signature);
  } catch {
    return false;
  }
}

async function hasPolicyBundleFile(policyDir: string): Promise<boolean> {
  try {
    await fsPromises.access(join(policyDir, "policy-bundle.json"));
    return true;
  } catch {
    return false;
  }
}

async function readExpectedDigest(policyDir: string): Promise<string | undefined> {
  const digestPath = join(policyDir, "policy-bundle.sha256");
  try {
    const raw = (await fsPromises.readFile(digestPath, "utf-8")).trim();
    if (!raw) return undefined;
    const [digest] = raw.split(/\s+/);
    return digest?.toLowerCase();
  } catch {
    return undefined;
  }
}

async function loadPolicyBundleFromEnvelope(
  policyDir: string,
  policySet: string,
  options: { policyBundlePublicKeyPath?: string }
): Promise<{ bundle?: PolicyBundle; reason?: string }> {
  const bundlePath = join(policyDir, "policy-bundle.json");
  try {
    const raw = await fsPromises.readFile(bundlePath, "utf-8");
    if (options.policyBundlePublicKeyPath) {
      const signatureValid = await verifyPolicyBundleSignature(
        policyDir,
        raw,
        options.policyBundlePublicKeyPath
      );
      if (!signatureValid) {
        return { reason: "bundle-signature-verification-failed" };
      }
    }

    const expectedDigest = await readExpectedDigest(policyDir);
    if (expectedDigest && sha256Hex(raw) !== expectedDigest) {
      return { reason: "bundle-digest-mismatch" };
    }

    const parsed = JSON.parse(raw) as PolicyBundleEnvelope;
    const policySets = parsed.policySets;
    if (!policySets || typeof policySets !== "object") {
      return { reason: "bundle-policy-sets-missing" };
    }

    return { bundle: normalizePolicyBundle(policySets[policySet]) };
  } catch {
    return { reason: "bundle-read-or-parse-failed" };
  }
}

async function loadPolicyBundle(
  policyDir: string,
  policySet: string,
  options: { policyBundlePublicKeyPath?: string }
): Promise<LoadPolicyBundleResult> {
  const bundleExists = await hasPolicyBundleFile(policyDir);
  const bundled = await loadPolicyBundleFromEnvelope(policyDir, policySet, options);
  if (bundled.bundle) {
    return {
      bundle: bundled.bundle,
      source: "bundle"
    };
  }

  const filePath = join(policyDir, `${policySet}.json`);
  try {
    const raw = await fsPromises.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<PolicyBundle>;
    return {
      bundle: normalizePolicyBundle(parsed),
      source: "policy-file",
      fallbackReason: bundleExists ? bundled.reason ?? "bundle-fallback" : undefined
    };
  } catch {
    return {
      bundle: DEFAULT_BUNDLE,
      source: "default",
      fallbackReason: bundleExists ? bundled.reason ?? "bundle-fallback" : undefined
    };
  }
}

export class OpaPolicyEngine implements PolicyEngine {
  private readonly policyDir: string;
  private readonly policyBundlePublicKeyPath?: string;
  private readonly onPolicyBundleFallback?: (reason: string, context: { policySet: string }) => void;

  constructor(options: OpaPolicyEngineOptions) {
    this.policyDir = resolve(options.serverRoot, options.policyDir ?? "config/policies");
    const configuredPath =
      options.policyBundlePublicKeyPath ?? process.env.SF_AI_POLICY_BUNDLE_PUBLIC_KEY_PATH;
    this.policyBundlePublicKeyPath = configuredPath
      ? resolveMaybeAbsolute(options.serverRoot, configuredPath)
      : undefined;
    this.onPolicyBundleFallback = options.onPolicyBundleFallback;
  }

  async evaluate(input: PolicyEngineEvaluateInput): Promise<PolicyEngineDecision> {
    const loaded = await loadPolicyBundle(this.policyDir, input.policySet, {
      policyBundlePublicKeyPath: this.policyBundlePublicKeyPath
    });
    const bundle = loaded.bundle;

    if (loaded.fallbackReason) {
      this.onPolicyBundleFallback?.(loaded.fallbackReason, { policySet: input.policySet });
      logger.warn(
        `Policy bundle fallback for policySet=${input.policySet}: reason=${loaded.fallbackReason}, source=${loaded.source}`
      );
    }

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
