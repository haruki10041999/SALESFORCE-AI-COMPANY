import assert from "node:assert/strict";
import test from "node:test";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";
import { ensureTenantRlsPolicy, withTenantScopedClient } from "../mcp/core/persistence/postgres-tenant-context.js";

test("tenant RLS policy isolates rows by app.tenant_id", async (t) => {
  let container: StartedPostgreSqlContainer | undefined;
  try {
    container = await new PostgreSqlContainer("pgvector/pgvector:pg17")
      .withDatabase("sfai")
      .withUsername("sfai")
      .withPassword("sfai")
      .start();
  } catch (error) {
    t.skip(`Docker/Testcontainers unavailable: ${String(error)}`);
    return;
  }

  const pool = new Pool({ connectionString: container.getConnectionUri() });
  try {
    await pool.query(
      [
        "CREATE TABLE IF NOT EXISTS tenant_rls_probe(",
        "  id text PRIMARY KEY,",
        "  tenant_id text,",
        "  value text NOT NULL",
        ")"
      ].join("\n")
    );

    const setupClient = await pool.connect();
    try {
      await ensureTenantRlsPolicy(setupClient, "tenant_rls_probe", "tenant_rls_probe_isolation");
    } finally {
      setupClient.release();
    }

    await pool.query(
      "INSERT INTO tenant_rls_probe(id, tenant_id, value) VALUES ($1, $2, $3), ($4, $5, $6)",
      ["a1", "tenant-a", "A", "b1", "tenant-b", "B"]
    );

    const unrestricted = await pool.query<{ id: string }>("SELECT id FROM tenant_rls_probe ORDER BY id ASC");
    assert.equal(unrestricted.rows.length, 2);

    const tenantA = await withTenantScopedClient(pool, (client) => {
      return client.query<{ id: string }>("SELECT id FROM tenant_rls_probe ORDER BY id ASC");
    }, "tenant-a");
    assert.deepEqual(tenantA.rows.map((row) => row.id), ["a1"]);

    const tenantB = await withTenantScopedClient(pool, (client) => {
      return client.query<{ id: string }>("SELECT id FROM tenant_rls_probe ORDER BY id ASC");
    }, "tenant-b");
    assert.deepEqual(tenantB.rows.map((row) => row.id), ["b1"]);

    await assert.rejects(async () => {
      await withTenantScopedClient(pool, (client) => {
        return client.query(
          "INSERT INTO tenant_rls_probe(id, tenant_id, value) VALUES ($1, $2, $3)",
          ["x1", "tenant-x", "X"]
        );
      }, "tenant-a");
    });
  } finally {
    await pool.end();
    await container.stop();
  }
});
