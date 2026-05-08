/**
 * Unified interface for durable orchestration session storage.
 *
 * Implementations:
 *  - SessionStorePostgres  (postgres-session-store.ts) — uses pg_try_advisory_lock
 *  - SessionStoreSqlite    (sqlite-session-store.ts)   — single-process, no locking
 *
 * Concurrency contract:
 *  - upsert() is optimistic-lock aware: it succeeds only when the stored version
 *    equals `expectedVersion`. A mismatch returns `{ updated: false }`.
 *  - acquireLock / releaseLock provide exclusive advisory locking in Postgres.
 *    SQLite implementation is a no-op (single-process assumption).
 */

import type { OrchestrationSession } from "../types/index.js";

export type SessionStatus = "active" | "paused" | "completed" | "failed";

export interface SessionSummary {
  id: string;
  topic: string;
  agents: string[];
  queueLength: number;
  historyCount: number;
  firedRuleCount: number;
  status: SessionStatus;
  version: number;
  updatedAt: string;
}

export interface UpsertResult {
  /** true if the row was written, false if version conflict occurred */
  updated: boolean;
  /** the current version after write (undefined on conflict) */
  version?: number;
}

export interface SessionStore {
  /**
   * Load a session from durable storage and cache it in the in-memory registry.
   * Returns null when the session does not exist.
   */
  getById(sessionId: string): Promise<OrchestrationSession | null>;

  /**
   * Persist a session using optimistic locking.
   * Pass `expectedVersion = -1` to skip version check (initial insert).
   */
  upsert(session: OrchestrationSession, expectedVersion: number): Promise<UpsertResult>;

  /**
   * Update the status of a session without touching session_json.
   */
  setStatus(sessionId: string, status: SessionStatus): Promise<void>;

  /**
   * Acquire an exclusive advisory lock for a session.
   * Returns true when the lock was acquired, false when already held.
   * Callers MUST call releaseLock() after finishing their critical section.
   */
  acquireLock(sessionId: string, lockOwner: string): Promise<boolean>;

  /**
   * Release the advisory lock for a session.
   */
  releaseLock(sessionId: string, lockOwner: string): Promise<void>;

  /**
   * List recent sessions ordered by updated_at DESC.
   */
  list(limit?: number): Promise<SessionSummary[]>;

  /**
   * Archive (soft-delete) sessions older than retentionDays.
   */
  archiveOld(): Promise<{ archived: number }>;

  /**
   * Close underlying connection pool.
   */
  close(): Promise<void>;
}
