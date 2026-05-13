import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { getOutputsDir } from "../mcp/core/config/runtime-config.js";
import { createTenant, deleteTenant, exportTenant, loadTenantLifecycle, resumeTenant, suspendTenant } from "../mcp/core/application/tenant/tenant-service.js";

function createTempRoot(): string {
  return mkdtempSync(join(tmpdir(), "sfai-tenant-"));
}

test("tenant lifecycle registry updates and export archive are persisted", async () => {
  const rootDir = createTempRoot();
  try {
    const created = await createTenant(rootDir, "tenant-acme");
    assert.equal(created.tenantId, "tenant-acme");
    assert.equal(created.status, "active");

    const suspended = await suspendTenant(rootDir, "tenant-acme");
    assert.equal(suspended.status, "suspended");
    assert.ok(suspended.suspendedAt);

    const resumed = await resumeTenant(rootDir, "tenant-acme");
    assert.equal(resumed.status, "active");
    assert.ok(!resumed.suspendedAt);

    const snapshot = await exportTenant(rootDir, "tenant-acme");
    assert.ok(existsSync(snapshot.archivePath));
    assert.ok(snapshot.archiveBytes > 0);
    assert.ok(snapshot.entryNames.includes("manifest.json"));
    assert.ok(snapshot.entryNames.includes("tenant.json"));

    const registryPath = resolve(rootDir, getOutputsDir(), "tenants", "tenant-registry.json");
    const registry = JSON.parse(readFileSync(registryPath, "utf-8")) as { tenants: Array<{ tenantId: string; status: string }> };
    const tenant = registry.tenants.find((item) => item.tenantId === "tenant-acme");
    assert.equal(tenant?.status, "active");

    const deleted = await deleteTenant(rootDir, "tenant-acme");
    assert.equal(deleted.tenant.status, "deleted");

    const afterDelete = await loadTenantLifecycle(rootDir, "tenant-acme");
    assert.equal(afterDelete?.status, "deleted");
  } finally {
    rmSync(rootDir, { recursive: true, force: true });
  }
});
