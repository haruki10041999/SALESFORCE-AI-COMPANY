import { promises as fsPromises } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import type { PoolClient } from "pg";
import writeFileAtomic from "write-file-atomic";
import { getOutputsDir, getPrimaryDatabaseUrl } from "../../config/runtime-config.js";
import { getOrCreatePgPool } from "../../persistence/pg-pool-registry.js";
import { writeTextFileAtomic } from "../../persistence/atomic-file.js";

export type TenantLifecycleStatus = "active" | "suspended" | "deleted";

export interface TenantLifecycleRecord {
  tenantId: string;
  status: TenantLifecycleStatus;
  createdAt: string;
  updatedAt: string;
  suspendedAt?: string;
  deletedAt?: string;
  lastExportAt?: string;
}

export interface TenantExportResult {
  tenant: TenantLifecycleRecord;
  archivePath: string;
  entryNames: string[];
  tableNames: string[];
  rowCounts: Record<string, number>;
  archiveBytes: number;
}

const TENANT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
let registryLock: Promise<void> = Promise.resolve();

function normalizeTenantId(tenantId: string): string {
  const normalized = tenantId.trim();
  if (!TENANT_ID_PATTERN.test(normalized)) {
    throw new Error(`invalid tenant id: ${tenantId}`);
  }
  return normalized;
}

function resolveTenantRoot(rootDir: string): string {
  return resolve(rootDir, getOutputsDir(), "tenants");
}

function resolveTenantRegistryPath(rootDir: string): string {
  return join(resolveTenantRoot(rootDir), "tenant-registry.json");
}

function resolveTenantExportDir(rootDir: string, tenantId: string): string {
  return join(resolveTenantRoot(rootDir), "exports", tenantId);
}

function createTenantRecord(tenantId: string, nowIso: string): TenantLifecycleRecord {
  return {
    tenantId,
    status: "active",
    createdAt: nowIso,
    updatedAt: nowIso
  };
}

async function withRegistryLock<T>(work: () => Promise<T>): Promise<T> {
  const previous = registryLock;
  let release: (() => void) | undefined;
  registryLock = new Promise<void>((resolveLock) => {
    release = resolveLock;
  });
  await previous;
  try {
    return await work();
  } finally {
    release?.();
  }
}

async function ensureTenantRoot(rootDir: string): Promise<void> {
  await fsPromises.mkdir(resolveTenantRoot(rootDir), { recursive: true });
}

async function loadTenantRegistry(rootDir: string): Promise<Record<string, TenantLifecycleRecord>> {
  const registryPath = resolveTenantRegistryPath(rootDir);
  try {
    const raw = await fsPromises.readFile(registryPath, "utf-8");
    const parsed = JSON.parse(raw) as { tenants?: TenantLifecycleRecord[] };
    const registry: Record<string, TenantLifecycleRecord> = {};
    for (const tenant of parsed.tenants ?? []) {
      if (tenant?.tenantId) {
        registry[tenant.tenantId] = tenant;
      }
    }
    return registry;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw new Error(`failed to load tenant registry: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function saveTenantRegistry(
  rootDir: string,
  registry: Record<string, TenantLifecycleRecord>
): Promise<void> {
  await ensureTenantRoot(rootDir);
  const tenants = Object.values(registry).sort((a, b) => a.tenantId.localeCompare(b.tenantId));
  await writeTextFileAtomic(resolveTenantRegistryPath(rootDir), `${JSON.stringify({ tenants }, null, 2)}\n`);
}

async function updateTenantRecord(
  rootDir: string,
  tenantId: string,
  update: (current: TenantLifecycleRecord | undefined, nowIso: string) => TenantLifecycleRecord
): Promise<TenantLifecycleRecord> {
  return withRegistryLock(async () => {
    const normalizedTenantId = normalizeTenantId(tenantId);
    const nowIso = new Date().toISOString();
    const registry = await loadTenantRegistry(rootDir);
    const next = update(registry[normalizedTenantId], nowIso);
    registry[normalizedTenantId] = next;
    await saveTenantRegistry(rootDir, registry);
    return next;
  });
}

export async function createTenant(rootDir: string, tenantId: string): Promise<TenantLifecycleRecord> {
  return updateTenantRecord(rootDir, tenantId, (current, nowIso) => {
    const normalizedTenantId = normalizeTenantId(tenantId);
    return {
      ...(current ?? createTenantRecord(normalizedTenantId, nowIso)),
      tenantId: normalizedTenantId,
      status: "active",
      createdAt: current?.createdAt ?? nowIso,
      updatedAt: nowIso,
      suspendedAt: undefined,
      deletedAt: undefined
    };
  });
}

export async function suspendTenant(rootDir: string, tenantId: string): Promise<TenantLifecycleRecord> {
  return updateTenantRecord(rootDir, tenantId, (current, nowIso) => {
    if (!current) {
      throw new Error(`tenant not found: ${tenantId}`);
    }
    if (current.status === "deleted") {
      throw new Error(`tenant is deleted: ${tenantId}`);
    }
    return {
      ...current,
      status: "suspended",
      updatedAt: nowIso,
      suspendedAt: nowIso
    };
  });
}

export async function resumeTenant(rootDir: string, tenantId: string): Promise<TenantLifecycleRecord> {
  return updateTenantRecord(rootDir, tenantId, (current, nowIso) => {
    if (!current) {
      throw new Error(`tenant not found: ${tenantId}`);
    }
    if (current.status === "deleted") {
      throw new Error(`tenant is deleted: ${tenantId}`);
    }
    return {
      ...current,
      status: "active",
      updatedAt: nowIso,
      suspendedAt: undefined
    };
  });
}

async function withTenantDatabaseClient<T>(databaseUrl: string, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const pool = getOrCreatePgPool(`tenant-lifecycle:${databaseUrl}`, databaseUrl);
  const client = await pool.connect();
  try {
    return await work(client);
  } finally {
    client.release();
  }
}

function quoteIdentifier(identifier: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(identifier)) {
    throw new Error(`invalid database identifier: ${identifier}`);
  }
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function listTenantScopedTables(client: PoolClient): Promise<string[]> {
  const result = await client.query<{ table_name: string }>(
    [
      "SELECT DISTINCT table_name",
      "FROM information_schema.columns",
      "WHERE table_schema = 'public' AND column_name = 'tenant_id'",
      "ORDER BY table_name"
    ].join("\n")
  );
  return result.rows.map((row) => row.table_name).filter((tableName) => /^[a-z_][a-z0-9_]*$/i.test(tableName));
}

async function readTenantRows(client: PoolClient, tableName: string, tenantId: string): Promise<Array<Record<string, unknown>>> {
  const result = await client.query<Record<string, unknown>>(
    `SELECT * FROM ${quoteIdentifier(tableName)} WHERE tenant_id = $1`,
    [tenantId]
  );
  return result.rows;
}

async function deleteTenantRows(client: PoolClient, tableName: string, tenantId: string): Promise<number> {
  const result = await client.query(`DELETE FROM ${quoteIdentifier(tableName)} WHERE tenant_id = $1`, [tenantId]);
  return result.rowCount ?? 0;
}

function createTarHeader(name: string, size: number, timestampMs: number): Buffer {
  const header = Buffer.alloc(512, 0);
  const normalizedName = name.replaceAll("\\", "/");
  if (Buffer.byteLength(normalizedName, "utf8") > 100) {
    throw new Error(`tar entry name too long: ${normalizedName}`);
  }

  header.write(normalizedName, 0, 100, "utf8");
  header.write("0000644\0", 100, "ascii");
  header.write("0000000\0", 108, "ascii");
  header.write("0000000\0", 116, "ascii");
  header.write(size.toString(8).padStart(11, "0") + "\0", 124, "ascii");
  header.write(Math.floor(timestampMs / 1000).toString(8).padStart(11, "0") + "\0", 136, "ascii");
  header.fill(0x20, 148, 156);
  header.write("0", 156, "ascii");
  header.write("ustar\0", 257, "ascii");
  header.write("00", 263, "ascii");
  header.write("root", 265, "ascii");
  header.write("root", 297, "ascii");

  let checksum = 0;
  for (const byte of header.values()) {
    checksum += byte;
  }
  header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, "ascii");
  return header;
}

function createTarArchive(entries: Array<{ name: string; content: Buffer }>): Buffer {
  const chunks: Buffer[] = [];
  const timestampMs = Date.now();
  for (const entry of entries) {
    const content = entry.content;
    chunks.push(createTarHeader(entry.name, content.length, timestampMs));
    chunks.push(content);
    const padding = (512 - (content.length % 512)) % 512;
    if (padding > 0) {
      chunks.push(Buffer.alloc(padding, 0));
    }
  }
  chunks.push(Buffer.alloc(512, 0));
  chunks.push(Buffer.alloc(512, 0));
  return Buffer.concat(chunks);
}

async function buildTenantExportEntries(
  rootDir: string,
  tenantId: string,
  tenant: TenantLifecycleRecord,
  databaseUrl?: string
): Promise<{ entries: Array<{ name: string; content: Buffer }>; tableNames: string[]; rowCounts: Record<string, number> }> {
  const tableNames: string[] = [];
  const rowCounts: Record<string, number> = {};
  const entries: Array<{ name: string; content: Buffer }> = [];

  const manifest = {
    tenant,
    exportedAt: new Date().toISOString(),
    rootDir: resolve(rootDir),
    databaseUrlConfigured: Boolean(databaseUrl),
    tableNames: [] as string[],
    rowCounts: {} as Record<string, number>
  };

  entries.push({
    name: "manifest.json",
    content: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8")
  });
  entries.push({
    name: "tenant.json",
    content: Buffer.from(`${JSON.stringify(tenant, null, 2)}\n`, "utf8")
  });

  if (databaseUrl) {
    await withTenantDatabaseClient(databaseUrl, async (client) => {
      const tables = await listTenantScopedTables(client);
      for (const tableName of tables) {
        tableNames.push(tableName);
        try {
          const rows = await readTenantRows(client, tableName, tenantId);
          rowCounts[tableName] = rows.length;
          entries.push({
            name: posix.join("tables", `${tableName}.json`),
            content: Buffer.from(`${JSON.stringify(rows, null, 2)}\n`, "utf8")
          });
        } catch (error) {
          rowCounts[tableName] = 0;
          entries.push({
            name: posix.join("errors", `${tableName}.txt`),
            content: Buffer.from(`${error instanceof Error ? error.message : String(error)}\n`, "utf8")
          });
        }
      }
    });
  }

  manifest.tableNames = tableNames;
  manifest.rowCounts = rowCounts;
  entries[0] = {
    name: "manifest.json",
    content: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8")
  };
  entries.push({
    name: posix.join("paths", "tenant-root.txt"),
    content: Buffer.from(`${resolveTenantRoot(rootDir)}\n`, "utf8")
  });

  return { entries, tableNames, rowCounts };
}

export async function exportTenant(rootDir: string, tenantId: string): Promise<TenantExportResult> {
  const normalizedTenantId = normalizeTenantId(tenantId);
  const registry = await loadTenantRegistry(rootDir);
  const tenant = registry[normalizedTenantId];
  if (!tenant) {
    throw new Error(`tenant not found: ${tenantId}`);
  }

  const databaseUrl = getPrimaryDatabaseUrl();
  const exportDir = resolveTenantExportDir(rootDir, normalizedTenantId);
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  const archivePath = join(exportDir, `${normalizedTenantId}-${timestamp}.tar.gz`);
  const built = await buildTenantExportEntries(rootDir, normalizedTenantId, tenant, databaseUrl);
  const archive = gzipSync(createTarArchive(built.entries));

  await fsPromises.mkdir(dirname(archivePath), { recursive: true });
  await writeFileAtomic(archivePath, archive);

  tenant.lastExportAt = new Date().toISOString();
  tenant.updatedAt = tenant.lastExportAt;
  registry[normalizedTenantId] = tenant;
  await saveTenantRegistry(rootDir, registry);

  return {
    tenant,
    archivePath,
    entryNames: built.entries.map((entry) => entry.name),
    tableNames: built.tableNames,
    rowCounts: built.rowCounts,
    archiveBytes: archive.length
  };
}

export async function deleteTenant(rootDir: string, tenantId: string): Promise<{ tenant: TenantLifecycleRecord; deletedRows: Record<string, number> }> {
  const normalizedTenantId = normalizeTenantId(tenantId);
  const registry = await loadTenantRegistry(rootDir);
  const current = registry[normalizedTenantId];
  const nowIso = new Date().toISOString();
  const tenant: TenantLifecycleRecord = {
    ...(current ?? createTenantRecord(normalizedTenantId, nowIso)),
    tenantId: normalizedTenantId,
    status: "deleted",
    createdAt: current?.createdAt ?? nowIso,
    updatedAt: nowIso,
    deletedAt: nowIso
  };

  const deletedRows: Record<string, number> = {};
  const databaseUrl = getPrimaryDatabaseUrl();
  if (databaseUrl) {
    await withTenantDatabaseClient(databaseUrl, async (client) => {
      const tables = await listTenantScopedTables(client);
      for (const tableName of tables) {
        try {
          deletedRows[tableName] = await deleteTenantRows(client, tableName, normalizedTenantId);
        } catch {
          deletedRows[tableName] = 0;
        }
      }
    });
  }

  registry[normalizedTenantId] = tenant;
  await saveTenantRegistry(rootDir, registry);
  await fsPromises.rm(resolveTenantExportDir(rootDir, normalizedTenantId), { recursive: true, force: true });

  return { tenant, deletedRows };
}

export async function loadTenantLifecycle(rootDir: string, tenantId: string): Promise<TenantLifecycleRecord | null> {
  const registry = await loadTenantRegistry(rootDir);
  const normalizedTenantId = normalizeTenantId(tenantId);
  return registry[normalizedTenantId] ?? null;
}
