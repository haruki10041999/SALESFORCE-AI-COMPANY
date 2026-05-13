import type { SessionSnapshot } from "./session-snapshot.js";

export const CURRENT_SESSION_SNAPSHOT_SCHEMA_VERSION = 2;

export function migrateSessionSnapshot(raw: unknown): SessionSnapshot {
  const snapshot = raw as Partial<SessionSnapshot> & Record<string, unknown>;
  const schemaVersion = typeof snapshot.schemaVersion === "number" ? snapshot.schemaVersion : 1;

  if (schemaVersion === CURRENT_SESSION_SNAPSHOT_SCHEMA_VERSION) {
    return {
      ...snapshot,
      schemaVersion: CURRENT_SESSION_SNAPSHOT_SCHEMA_VERSION
    } as SessionSnapshot;
  }

  if (schemaVersion === 1) {
    return {
      ...snapshot,
      schemaVersion: CURRENT_SESSION_SNAPSHOT_SCHEMA_VERSION
    } as SessionSnapshot;
  }

  throw new Error(`Unsupported session snapshot schema version: ${schemaVersion}`);
}