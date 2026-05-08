import type { Pool, PoolClient } from "pg";
import { currentTenantId } from "../identity/tenant-context.js";

function sanitizeIdentifier(value: string, kind: "table" | "policy"): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) {
    throw new Error(`Invalid ${kind} identifier: ${value}`);
  }
  return value;
}

function tenantSettingValue(tenantId?: string): string {
  return (tenantId ?? currentTenantId() ?? "").trim();
}

export async function setTenantSetting(client: PoolClient, tenantId?: string): Promise<void> {
  await client.query("SELECT set_config('app.tenant_id', $1, false)", [tenantSettingValue(tenantId)]);
}

export async function resetTenantSetting(client: PoolClient): Promise<void> {
  try {
    await client.query("RESET app.tenant_id");
  } catch {
    // Ignore reset failures to avoid hiding a primary error path.
  }
}

export async function withTenantScopedClient<T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>,
  tenantId?: string
): Promise<T> {
  const client = await pool.connect();
  try {
    await setTenantSetting(client, tenantId);
    return await work(client);
  } finally {
    await resetTenantSetting(client);
    client.release();
  }
}

export async function ensureTenantRlsPolicy(
  client: PoolClient,
  tableName: string,
  policyName: string
): Promise<void> {
  const table = sanitizeIdentifier(tableName, "table");
  const policy = sanitizeIdentifier(policyName, "policy");
  const predicate = [
    "COALESCE(current_setting('app.tenant_id', true), '') = ''",
    "OR tenant_id IS NOT DISTINCT FROM NULLIF(current_setting('app.tenant_id', true), '')"
  ].join(" ");

  await client.query(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
  await client.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
  await client.query(
    [
      "DO $$",
      "BEGIN",
      "  IF NOT EXISTS (",
      "    SELECT 1",
      "    FROM pg_policies",
      `    WHERE schemaname = 'public' AND tablename = '${table}' AND policyname = '${policy}'`,
      "  ) THEN",
      `    CREATE POLICY ${policy} ON ${table}`,
      `      USING (${predicate})`,
      `      WITH CHECK (${predicate});`,
      "  END IF;",
      "END $$"
    ].join("\n")
  );
}
