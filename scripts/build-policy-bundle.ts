import { promises as fs } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { createHash, createPrivateKey, sign } from "node:crypto";

type PolicyEffect = "allow" | "deny";

interface PolicyRule {
  id: string;
  effect: PolicyEffect;
}

interface PolicyBundle {
  version: string;
  defaultEffect: PolicyEffect;
  rules: PolicyRule[];
}

interface PolicyBundleEnvelope {
  version: string;
  generatedAt: string;
  policySets: Record<string, PolicyBundle>;
}

function resolvePolicyDir(argv: string[]): string {
  const policyDirFlag = argv.find((arg) => arg.startsWith("--policy-dir="));
  if (policyDirFlag) {
    return resolve(process.cwd(), policyDirFlag.slice("--policy-dir=".length));
  }

  const flagIndex = argv.indexOf("--policy-dir");
  if (flagIndex >= 0 && argv[flagIndex + 1]) {
    return resolve(process.cwd(), argv[flagIndex + 1]);
  }

  return resolve(process.cwd(), "config/policies");
}

function resolveSigningPrivateKeyPath(argv: string[]): string | undefined {
  const signingFlag = argv.find((arg) => arg.startsWith("--signing-private-key="));
  if (signingFlag) {
    return resolve(process.cwd(), signingFlag.slice("--signing-private-key=".length));
  }

  const flagIndex = argv.indexOf("--signing-private-key");
  if (flagIndex >= 0 && argv[flagIndex + 1]) {
    return resolve(process.cwd(), argv[flagIndex + 1]);
  }

  return undefined;
}

function isPolicyBundle(value: unknown): value is PolicyBundle {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record.defaultEffect !== "allow" && record.defaultEffect !== "deny") return false;
  if (!Array.isArray(record.rules)) return false;
  return record.rules.every((rule) => {
    if (!rule || typeof rule !== "object") return false;
    const item = rule as Record<string, unknown>;
    return typeof item.id === "string" && (item.effect === "allow" || item.effect === "deny");
  });
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const policyDir = resolvePolicyDir(argv);
  const signingPrivateKeyPath = resolveSigningPrivateKeyPath(argv);
  const entries = await fs.readdir(policyDir, { withFileTypes: true });

  const policySets: Record<string, PolicyBundle> = {};

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (extname(entry.name) !== ".json") continue;
    if (entry.name === "policy-bundle.json") continue;

    const fullPath = join(policyDir, entry.name);
    const raw = await fs.readFile(fullPath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isPolicyBundle(parsed)) continue;

    const setName = basename(entry.name, ".json");
    policySets[setName] = parsed;
  }

  const envelope: PolicyBundleEnvelope = {
    version: "1.0",
    generatedAt: new Date().toISOString(),
    policySets
  };

  const bundleText = `${JSON.stringify(envelope, null, 2)}\n`;
  const bundlePath = join(policyDir, "policy-bundle.json");
  await fs.writeFile(bundlePath, bundleText, "utf-8");

  const digest = createHash("sha256").update(bundleText).digest("hex");
  const digestPath = join(policyDir, "policy-bundle.sha256");
  await fs.writeFile(digestPath, `${digest}  policy-bundle.json\n`, "utf-8");

  if (signingPrivateKeyPath) {
    const privateKeyPem = await fs.readFile(signingPrivateKeyPath, "utf-8");
    const signature = sign(null, Buffer.from(bundleText, "utf-8"), createPrivateKey(privateKeyPem));
    const signaturePath = join(policyDir, "policy-bundle.sig");
    await fs.writeFile(signaturePath, `${signature.toString("base64")}\n`, "utf-8");
  }

  process.stdout.write(`Built policy bundle with ${Object.keys(policySets).length} policy sets.\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
