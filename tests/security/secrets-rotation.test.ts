import { test } from "node:test";
import assert from "node:assert";
import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";
import {
  SecretsManager,
  hydrateEnvFromSecrets,
} from "../../mcp/core/security/secrets.js";
import { EnvSecretsBackend } from "../../mcp/core/security/secrets-backends/env-backend.js";
import { FileSecretsBackend } from "../../mcp/core/security/secrets-backends/file-backend.js";
import { VaultSecretsBackend } from "../../mcp/core/security/secrets-backends/vault-backend.js";

test("EnvSecretsBackend retrieves environment variable", async () => {
  process.env.TEST_SECRET = "test-value-123";
  const backend = new EnvSecretsBackend();

  const result = await backend.getSecret("TEST_SECRET");

  assert.equal(result.value, "test-value-123");
  assert.equal(result.version, "env");
});

test("EnvSecretsBackend throws on missing secret", async () => {
  const backend = new EnvSecretsBackend();

  await assert.rejects(
    () => backend.getSecret("NONEXISTENT_SECRET_12345"),
    /Secret not found/,
  );
});

test("FileSecretsBackend reads and writes secrets", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "secrets-"));
  const backend = new FileSecretsBackend(tempDir);

  // Write secret
  await backend.setSecret("MY_KEY", "my-secret-value");

  // Read secret
  const result = await backend.getSecret("MY_KEY");
  assert.equal(result.value, "my-secret-value");
  assert.ok(result.version); // Should have mtime-based version

  // Cleanup
  await fs.rm(tempDir, { recursive: true });
});

test("FileSecretsBackend deletes secrets", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "secrets-"));
  const backend = new FileSecretsBackend(tempDir);

  await backend.setSecret("KEY_TO_DELETE", "value");
  await backend.deleteSecret("KEY_TO_DELETE");

  // Try to read deleted secret
  await assert.rejects(
    () => backend.getSecret("KEY_TO_DELETE"),
    /Secret file not found/,
  );

  // Cleanup
  await fs.rm(tempDir, { recursive: true });
});

test("SecretsManager caches secrets with TTL", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "secrets-"));
  const manager = new SecretsManager({
    backend: "file",
    ttlMs: 100, // 100ms TTL for testing
    filePath: tempDir,
    auditEnabled: false,
  });

  await (manager["backend"] as any).setSecret("CACHED_KEY", "value1");

  // First read from backend
  const value1 = await manager.getSecret("CACHED_KEY");
  assert.equal(value1, "value1");

  // Modify underlying file
  await (manager["backend"] as any).setSecret("CACHED_KEY", "value2");

  // Should still return cached value
  const value2 = await manager.getSecret("CACHED_KEY");
  assert.equal(value2, "value1"); // Cached value

  // Wait for TTL to expire
  await new Promise((resolve) => setTimeout(resolve, 150));

  // Should now return new value
  const value3 = await manager.getSecret("CACHED_KEY");
  assert.equal(value3, "value2");

  manager.destroy();
  await fs.rm(tempDir, { recursive: true });
});

test("SecretsManager detects secret rotation", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "secrets-"));
  const manager = new SecretsManager({
    backend: "file",
    ttlMs: 60000,
    rotationCheckMs: 0, // Disable timer
    filePath: tempDir,
    auditEnabled: false,
  });

  await (manager["backend"] as any).setSecret("ROTATION_KEY", "version1");

  // Get initial value and version
  const value1 = await manager.getSecret("ROTATION_KEY", {
    checkRotation: false,
  });
  assert.equal(value1, "version1");

  // Wait a bit and change the secret
  await new Promise((resolve) => setTimeout(resolve, 10));
  await (manager["backend"] as any).setSecret("ROTATION_KEY", "version2");

  // Listen for rotation event
  let rotationDetected = false;
  manager.once("secret-rotated", (event) => {
    assert.equal(event.name, "ROTATION_KEY");
    rotationDetected = true;
  });

  // Get with rotation check
  const value2 = await manager.getSecret("ROTATION_KEY", {
    checkRotation: true,
  });
  // Cache will still return old value, but rotation event should fire
  // because the underlying secret file changed
  assert.ok(rotationDetected);

  manager.destroy();
  await fs.rm(tempDir, { recursive: true });
});

test("SecretsManager invalidates cache", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "secrets-"));
  const manager = new SecretsManager({
    backend: "file",
    ttlMs: 60000,
    filePath: tempDir,
    auditEnabled: false,
  });

  await (manager["backend"] as any).setSecret("INVALIDATE_KEY", "value1");

  const value1 = await manager.getSecret("INVALIDATE_KEY");
  assert.equal(value1, "value1");

  // Change and invalidate
  await (manager["backend"] as any).setSecret("INVALIDATE_KEY", "value2");
  manager.invalidateSecret("INVALIDATE_KEY");

  const value2 = await manager.getSecret("INVALIDATE_KEY");
  assert.equal(value2, "value2"); // Should fetch new value

  manager.destroy();
  await fs.rm(tempDir, { recursive: true });
});

test("SecretsManager provides cache statistics", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "secrets-"));
  const manager = new SecretsManager({
    backend: "file",
    filePath: tempDir,
    auditEnabled: false,
  });

  await (manager["backend"] as any).setSecret("KEY1", "value1");
  await (manager["backend"] as any).setSecret("KEY2", "value2");

  await manager.getSecret("KEY1");
  await manager.getSecret("KEY2");

  const stats = manager.getCacheStats();
  assert.equal(stats.size, 2);
  assert.ok(stats.keys.includes("KEY1"));
  assert.ok(stats.keys.includes("KEY2"));

  manager.destroy();
  await fs.rm(tempDir, { recursive: true });
});

test("hydrateEnvFromSecrets loads only missing env keys", async () => {
  process.env.EXISTING_ENV_VAR = "already-present";
  delete process.env.MISSING_ENV_VAR;

  const fakeManager = {
    async getSecret(name: string): Promise<string> {
      return `value-for-${name}`;
    },
  } as SecretsManager;

  const result = await hydrateEnvFromSecrets(
    {
      EXISTING_ENV_VAR: "existing/value",
      MISSING_ENV_VAR: "missing/value",
    },
    fakeManager,
  );

  assert.equal(process.env.EXISTING_ENV_VAR, "already-present");
  assert.equal(process.env.MISSING_ENV_VAR, "value-for-missing/value");
  assert.ok(result.loaded.includes("MISSING_ENV_VAR"));
  assert.ok(!result.loaded.includes("EXISTING_ENV_VAR"));

  delete process.env.EXISTING_ENV_VAR;
  delete process.env.MISSING_ENV_VAR;
});

test("VaultSecretsBackend reads KV-v2 secret payload", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    return new Response(
      JSON.stringify({
        data: {
          data: {
            value: "vault-secret-value",
          },
          metadata: {
            version: 3,
          },
        },
      }),
      { status: 200 },
    );
  }) as typeof fetch;

  try {
    const backend = new VaultSecretsBackend({
      addr: "http://127.0.0.1:8200",
      authValue: "placeholder-auth",
    });
    const result = await backend.getSecret("OPENAI_API_KEY");
    assert.equal(result.value, "vault-secret-value");
    assert.equal(result.version, "3");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
