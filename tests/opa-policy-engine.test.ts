import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { OpaPolicyEngine } from "../mcp/core/governance/opa-policy-engine.js";

function makeServerRoot(): { serverRoot: string; cleanup: () => void } {
  const serverRoot = mkdtempSync(join(tmpdir(), "sf-ai-policy-engine-"));
  mkdirSync(join(serverRoot, "config", "policies"), { recursive: true });
  return {
    serverRoot,
    cleanup: () => rmSync(serverRoot, { recursive: true, force: true })
  };
}

test("opa policy engine denies matching rule", async () => {
  const paths = makeServerRoot();
  writeFileSync(
    join(paths.serverRoot, "config", "policies", "tool_access.json"),
    JSON.stringify({
      version: "1.0",
      defaultEffect: "allow",
      rules: [
        {
          id: "deny.viewer.apply_proposal",
          effect: "deny",
          tools: ["apply_proposal"],
          roles: ["viewer"]
        }
      ]
    }),
    "utf-8"
  );

  const engine = new OpaPolicyEngine({ serverRoot: paths.serverRoot });
  const decision = await engine.evaluate({
    policySet: "tool_access",
    toolName: "apply_proposal",
    actor: { id: "u-1", role: "viewer" },
    input: {}
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.ruleId, "deny.viewer.apply_proposal");
  paths.cleanup();
});

test("opa policy engine falls back to default allow when no file exists", async () => {
  const paths = makeServerRoot();
  const engine = new OpaPolicyEngine({ serverRoot: paths.serverRoot });
  const decision = await engine.evaluate({
    policySet: "tool_access",
    toolName: "health_check",
    actor: { id: "u-2", role: "viewer" },
    input: {}
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.ruleId, "default");
  paths.cleanup();
});

test("opa policy engine loads policy set from policy bundle", async () => {
  const paths = makeServerRoot();
  const bundleText = JSON.stringify({
    version: "1.0",
    generatedAt: new Date().toISOString(),
    policySets: {
      tool_access: {
        version: "1.0",
        defaultEffect: "allow",
        rules: [
          {
            id: "deny.viewer.apply_proposal.from_bundle",
            effect: "deny",
            tools: ["apply_proposal"],
            roles: ["viewer"]
          }
        ]
      }
    }
  }, null, 2) + "\n";

  writeFileSync(join(paths.serverRoot, "config", "policies", "policy-bundle.json"), bundleText, "utf-8");
  writeFileSync(
    join(paths.serverRoot, "config", "policies", "policy-bundle.sha256"),
    `${createHash("sha256").update(bundleText).digest("hex")}  policy-bundle.json\n`,
    "utf-8"
  );

  const engine = new OpaPolicyEngine({ serverRoot: paths.serverRoot });
  const decision = await engine.evaluate({
    policySet: "tool_access",
    toolName: "apply_proposal",
    actor: { id: "u-3", role: "viewer" },
    input: {}
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.ruleId, "deny.viewer.apply_proposal.from_bundle");
  paths.cleanup();
});

test("opa policy engine ignores invalid bundle digest and falls back to policy file", async () => {
  const paths = makeServerRoot();
  const bundleText = JSON.stringify({
    version: "1.0",
    generatedAt: new Date().toISOString(),
    policySets: {
      tool_access: {
        version: "1.0",
        defaultEffect: "deny",
        rules: []
      }
    }
  }, null, 2) + "\n";

  writeFileSync(join(paths.serverRoot, "config", "policies", "policy-bundle.json"), bundleText, "utf-8");
  writeFileSync(join(paths.serverRoot, "config", "policies", "policy-bundle.sha256"), "deadbeef  policy-bundle.json\n", "utf-8");
  writeFileSync(
    join(paths.serverRoot, "config", "policies", "tool_access.json"),
    JSON.stringify({
      version: "1.0",
      defaultEffect: "allow",
      rules: [
        {
          id: "deny.viewer.apply_proposal.from_file",
          effect: "deny",
          tools: ["apply_proposal"],
          roles: ["viewer"]
        }
      ]
    }),
    "utf-8"
  );

  const engine = new OpaPolicyEngine({ serverRoot: paths.serverRoot });
  const decision = await engine.evaluate({
    policySet: "tool_access",
    toolName: "apply_proposal",
    actor: { id: "u-4", role: "viewer" },
    input: {}
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.ruleId, "deny.viewer.apply_proposal.from_file");
  paths.cleanup();
});

test("opa policy engine verifies signed policy bundle", async () => {
  const paths = makeServerRoot();
  const keyPair = generateKeyPairSync("ed25519");
  const publicKeyPem = keyPair.publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKeyPem = keyPair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();

  const bundleText = JSON.stringify({
    version: "1.0",
    generatedAt: new Date().toISOString(),
    policySets: {
      tool_access: {
        version: "1.0",
        defaultEffect: "allow",
        rules: [
          {
            id: "deny.viewer.apply_proposal.signed_bundle",
            effect: "deny",
            tools: ["apply_proposal"],
            roles: ["viewer"]
          }
        ]
      }
    }
  }, null, 2) + "\n";

  const signature = sign(null, Buffer.from(bundleText, "utf-8"), privateKeyPem).toString("base64");
  writeFileSync(join(paths.serverRoot, "config", "policies", "policy-bundle.json"), bundleText, "utf-8");
  writeFileSync(join(paths.serverRoot, "config", "policies", "policy-bundle.sig"), `${signature}\n`, "utf-8");
  writeFileSync(
    join(paths.serverRoot, "config", "policies", "policy-bundle.sha256"),
    `${createHash("sha256").update(bundleText).digest("hex")}  policy-bundle.json\n`,
    "utf-8"
  );
  writeFileSync(join(paths.serverRoot, "policy-bundle.public.pem"), publicKeyPem, "utf-8");

  const engine = new OpaPolicyEngine({
    serverRoot: paths.serverRoot,
    policyBundlePublicKeyPath: "policy-bundle.public.pem"
  });
  const decision = await engine.evaluate({
    policySet: "tool_access",
    toolName: "apply_proposal",
    actor: { id: "u-5", role: "viewer" },
    input: {}
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.ruleId, "deny.viewer.apply_proposal.signed_bundle");
  paths.cleanup();
});

test("opa policy engine falls back to policy file when bundle signature is invalid", async () => {
  const paths = makeServerRoot();
  const keyPair = generateKeyPairSync("ed25519");
  const publicKeyPem = keyPair.publicKey.export({ type: "spki", format: "pem" }).toString();

  const bundleText = JSON.stringify({
    version: "1.0",
    generatedAt: new Date().toISOString(),
    policySets: {
      tool_access: {
        version: "1.0",
        defaultEffect: "deny",
        rules: []
      }
    }
  }, null, 2) + "\n";

  writeFileSync(join(paths.serverRoot, "config", "policies", "policy-bundle.json"), bundleText, "utf-8");
  writeFileSync(join(paths.serverRoot, "config", "policies", "policy-bundle.sig"), "invalid-signature\n", "utf-8");
  writeFileSync(join(paths.serverRoot, "policy-bundle.public.pem"), publicKeyPem, "utf-8");
  writeFileSync(
    join(paths.serverRoot, "config", "policies", "tool_access.json"),
    JSON.stringify({
      version: "1.0",
      defaultEffect: "allow",
      rules: [
        {
          id: "deny.viewer.apply_proposal.from_file.signature_fallback",
          effect: "deny",
          tools: ["apply_proposal"],
          roles: ["viewer"]
        }
      ]
    }),
    "utf-8"
  );

  const engine = new OpaPolicyEngine({
    serverRoot: paths.serverRoot,
    policyBundlePublicKeyPath: "policy-bundle.public.pem"
  });
  const decision = await engine.evaluate({
    policySet: "tool_access",
    toolName: "apply_proposal",
    actor: { id: "u-6", role: "viewer" },
    input: {}
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.ruleId, "deny.viewer.apply_proposal.from_file.signature_fallback");
  paths.cleanup();
});

test("opa policy engine reports fallback reason on invalid signature", async () => {
  const paths = makeServerRoot();
  const keyPair = generateKeyPairSync("ed25519");
  const publicKeyPem = keyPair.publicKey.export({ type: "spki", format: "pem" }).toString();
  const fallbackReasons: string[] = [];

  const bundleText = JSON.stringify({
    version: "1.0",
    generatedAt: new Date().toISOString(),
    policySets: {
      tool_access: {
        version: "1.0",
        defaultEffect: "deny",
        rules: []
      }
    }
  }, null, 2) + "\n";

  writeFileSync(join(paths.serverRoot, "config", "policies", "policy-bundle.json"), bundleText, "utf-8");
  writeFileSync(join(paths.serverRoot, "config", "policies", "policy-bundle.sig"), "not-a-valid-signature\n", "utf-8");
  writeFileSync(join(paths.serverRoot, "policy-bundle.public.pem"), publicKeyPem, "utf-8");
  writeFileSync(
    join(paths.serverRoot, "config", "policies", "tool_access.json"),
    JSON.stringify({ version: "1.0", defaultEffect: "allow", rules: [] }),
    "utf-8"
  );

  const engine = new OpaPolicyEngine({
    serverRoot: paths.serverRoot,
    policyBundlePublicKeyPath: "policy-bundle.public.pem",
    onPolicyBundleFallback: (reason) => fallbackReasons.push(reason)
  });

  await engine.evaluate({
    policySet: "tool_access",
    toolName: "health_check",
    actor: { id: "u-7", role: "viewer" },
    input: {}
  });

  assert.deepEqual(fallbackReasons, ["bundle-signature-verification-failed"]);
  paths.cleanup();
});

test("opa policy engine reports fallback reason on digest mismatch", async () => {
  const paths = makeServerRoot();
  const fallbackReasons: string[] = [];

  const bundleText = JSON.stringify({
    version: "1.0",
    generatedAt: new Date().toISOString(),
    policySets: {
      tool_access: {
        version: "1.0",
        defaultEffect: "deny",
        rules: []
      }
    }
  }, null, 2) + "\n";

  writeFileSync(join(paths.serverRoot, "config", "policies", "policy-bundle.json"), bundleText, "utf-8");
  writeFileSync(join(paths.serverRoot, "config", "policies", "policy-bundle.sha256"), "deadbeef  policy-bundle.json\n", "utf-8");
  writeFileSync(
    join(paths.serverRoot, "config", "policies", "tool_access.json"),
    JSON.stringify({ version: "1.0", defaultEffect: "allow", rules: [] }),
    "utf-8"
  );

  const engine = new OpaPolicyEngine({
    serverRoot: paths.serverRoot,
    onPolicyBundleFallback: (reason) => fallbackReasons.push(reason)
  });

  await engine.evaluate({
    policySet: "tool_access",
    toolName: "health_check",
    actor: { id: "u-8", role: "viewer" },
    input: {}
  });

  assert.deepEqual(fallbackReasons, ["bundle-digest-mismatch"]);
  paths.cleanup();
});
