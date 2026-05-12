import { Pool } from "pg";

const keyToUrl = new Map<string, string>();
const poolsByUrl = new Map<string, Pool>();
const refsByUrl = new Map<string, number>();

function normalizeConnectionString(connectionString: string): string {
  return connectionString.trim();
}

export function getOrCreatePgPool(key: string, connectionString: string): Pool {
  const normalizedUrl = normalizeConnectionString(connectionString);
  if (!normalizedUrl) {
    throw new Error("connectionString is required");
  }

  const mappedUrl = keyToUrl.get(key);
  if (mappedUrl) {
    const existing = poolsByUrl.get(mappedUrl);
    if (existing) {
      return existing;
    }
  }

  const byUrl = poolsByUrl.get(normalizedUrl);
  if (byUrl) {
    keyToUrl.set(key, normalizedUrl);
    refsByUrl.set(normalizedUrl, (refsByUrl.get(normalizedUrl) ?? 0) + 1);
    return byUrl;
  }

  const created = new Pool({ connectionString: normalizedUrl });
  poolsByUrl.set(normalizedUrl, created);
  keyToUrl.set(key, normalizedUrl);
  refsByUrl.set(normalizedUrl, (refsByUrl.get(normalizedUrl) ?? 0) + 1);
  return created;
}

export function clearPgPoolKey(key: string): void {
  const mappedUrl = keyToUrl.get(key);
  if (!mappedUrl) {
    return;
  }
  keyToUrl.delete(key);
  const next = Math.max(0, (refsByUrl.get(mappedUrl) ?? 0) - 1);
  if (next === 0) {
    refsByUrl.delete(mappedUrl);
    return;
  }
  refsByUrl.set(mappedUrl, next);
}

export async function releasePgPoolKey(key: string): Promise<void> {
  const mappedUrl = keyToUrl.get(key);
  if (!mappedUrl) {
    return;
  }
  clearPgPoolKey(key);
  const remaining = refsByUrl.get(mappedUrl) ?? 0;
  if (remaining > 0) {
    return;
  }

  const pool = poolsByUrl.get(mappedUrl);
  poolsByUrl.delete(mappedUrl);
  if (!pool) {
    return;
  }
  try {
    await pool.end();
  } catch {
    // best-effort cleanup for tests and process shutdown
  }
}

export async function closeAllPgPools(): Promise<void> {
  const pools = [...poolsByUrl.values()];
  keyToUrl.clear();
  poolsByUrl.clear();
  refsByUrl.clear();
  await Promise.all(pools.map(async (pool) => {
    try {
      await pool.end();
    } catch {
      // best-effort cleanup for tests and process shutdown
    }
  }));
}
