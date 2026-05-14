import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";

function createWorkspace(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "sf-ai-policy-bundle-"));
  mkdirSync(join(root, "config", "policies"), { recursive: true });
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true })
  };
}

test("build-policy-bundle creates bundle and sha256 sidecar", () => {
  const ws = createWorkspace();

  writeFileSync(
    join(ws.root, "config", "policies", "tool_access.json"),
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

  const repoRoot = process.cwd();
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      join(repoRoot, "scripts", "build-policy-bundle.ts"),
      "--policy-dir",
      join(ws.root, "config", "policies")
    ],
    {
      cwd: repoRoot,
      encoding: "utf-8"
    }
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);

  const bundlePath = join(ws.root, "config", "policies", "policy-bundle.json");
  const digestPath = join(ws.root, "config", "policies", "policy-bundle.sha256");

  const bundleText = readFileSync(bundlePath, "utf-8");
  const digestText = readFileSync(digestPath, "utf-8");

  assert.match(bundleText, /"policySets"/);
  assert.match(bundleText, /"tool_access"/);
  assert.match(digestText, /^[a-f0-9]{64}\s+policy-bundle\.json\s*$/i);

  ws.cleanup();
});

test("build-policy-bundle emits signature when signing key is provided", () => {
  const ws = createWorkspace();

  writeFileSync(
    join(ws.root, "config", "policies", "tool_access.json"),
    JSON.stringify({
      version: "1.0",
      defaultEffect: "allow",
      rules: []
    }),
    "utf-8"
  );

  const keyPair = generateKeyPairSync("ed25519");
  const privateKeyPath = join(ws.root, "policy-bundle.private.pem");
  writeFileSync(
    privateKeyPath,
    keyPair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    "utf-8"
  );

  const repoRoot = process.cwd();
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      join(repoRoot, "scripts", "build-policy-bundle.ts"),
      "--policy-dir",
      join(ws.root, "config", "policies"),
      "--signing-private-key",
      privateKeyPath
    ],
    {
      cwd: repoRoot,
      encoding: "utf-8"
    }
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const signatureText = readFileSync(join(ws.root, "config", "policies", "policy-bundle.sig"), "utf-8");
  assert.match(signatureText.trim(), /^[A-Za-z0-9+/=]+$/);

  ws.cleanup();
});
