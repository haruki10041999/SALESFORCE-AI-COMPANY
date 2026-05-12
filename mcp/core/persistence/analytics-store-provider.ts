import { PostgresAnalyticsStore } from "./postgres-analytics-store.js";
import { getPrimaryDatabaseUrl } from "../config/runtime-config.js";

let cachedUrl: string | null = null;
let cachedStorePromise: Promise<PostgresAnalyticsStore | null> | null = null;

function resolveAnalyticsDatabaseUrl(): string | null {
  return getPrimaryDatabaseUrl() ?? null;
}

export function hasAnalyticsDatabaseConfig(): boolean {
  return resolveAnalyticsDatabaseUrl() !== null;
}

export function resetAnalyticsStoreProviderForTest(): void {
  cachedUrl = null;
  cachedStorePromise = null;
}

export async function getAnalyticsStore(): Promise<PostgresAnalyticsStore | null> {
  const databaseUrl = resolveAnalyticsDatabaseUrl();
  if (!databaseUrl) {
    return null;
  }

  if (cachedStorePromise && cachedUrl === databaseUrl) {
    return cachedStorePromise;
  }

  cachedUrl = databaseUrl;
  cachedStorePromise = PostgresAnalyticsStore.open({ databaseUrl }).catch(() => null);
  return cachedStorePromise;
}
