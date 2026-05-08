import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  DatabaseSync,
  type SQLInputValue,
  type SQLOutputValue,
  type StatementSync
} from "node:sqlite";
import {
  createAtRestCryptoFromEnv,
  parseEncryptedEnvelope,
  type EncryptedEnvelope,
  type AtRestCrypto
} from "../security/at-rest-crypto.js";

type SqlBindParams = SQLInputValue[] | Record<string, SQLInputValue> | undefined;

interface SqliteRunResult {
  changes: number;
}

export interface HistorySessionRecord {
  id: string;
  timestamp: string;
  topic: string;
  agents: string[];
  entries: unknown[];
}

export interface JsonlRecordInput {
  stream: string;
  payload: string;
  sourcePath?: string;
  lineNumber?: number;
  importedAt?: string;
}

export interface JsonlRecordRow {
  id: number;
  stream: string;
  payload: string;
  sourcePath: string | null;
  lineNumber: number | null;
  importedAt: string;
}

export interface GovernanceStateRow {
  stateJson: string;
  updatedAt: string;
}

export interface SQLiteStateStoreOptions {
  dbPath: string;
}

export const DEFAULT_SQLITE_STATE_FILE = "state.sqlite";

type QueryRow = Record<string, SQLOutputValue>;

function ensureParentDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function isEncryptedEnvelope(value: unknown): value is EncryptedEnvelope {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.alg === "string"
    && typeof record.keyId === "string"
    && typeof record.iv === "string"
    && typeof record.tag === "string"
    && typeof record.ciphertext === "string";
}

export class SQLiteStateStore {
  private readonly db: DatabaseSync;
  private readonly dbPath: string;
  private readonly atRestCrypto: AtRestCrypto | null;
  private inTransaction = false;

  private constructor(dbPath: string, db: DatabaseSync) {
    this.dbPath = dbPath;
    this.db = db;
    this.atRestCrypto = createAtRestCryptoFromEnv();
    this.initSchema();
  }

  public static async open(options: SQLiteStateStoreOptions): Promise<SQLiteStateStore> {
    const dbPath = resolve(options.dbPath);
    ensureParentDir(dbPath);
    const db = new DatabaseSync(dbPath);
    return new SQLiteStateStore(dbPath, db);
  }

  public get path(): string {
    return this.dbPath;
  }

  public close(): void {
    this.db.close();
  }

  public executeInTransaction<T>(work: () => T): T {
    this.db.exec("BEGIN");
    this.inTransaction = true;
    try {
      const result = work();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    } finally {
      this.inTransaction = false;
    }
  }

  private initSchema(): void {
    this.db.exec("PRAGMA journal_mode=WAL;");
    this.db.exec("PRAGMA synchronous=NORMAL;");
    this.db.exec("PRAGMA foreign_keys=ON;");
    this.db.exec(
      [
        "CREATE TABLE IF NOT EXISTS history_sessions (",
        "  id TEXT PRIMARY KEY,",
        "  timestamp TEXT NOT NULL,",
        "  topic TEXT NOT NULL,",
        "  agents_json TEXT NOT NULL,",
        "  entries_json TEXT NOT NULL,",
        "  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
        ");",
        "CREATE INDEX IF NOT EXISTS idx_history_sessions_timestamp ON history_sessions(timestamp DESC);",
        "CREATE TABLE IF NOT EXISTS jsonl_records (",
        "  id INTEGER PRIMARY KEY AUTOINCREMENT,",
        "  stream TEXT NOT NULL,",
        "  payload TEXT NOT NULL,",
        "  source_path TEXT,",
        "  line_number INTEGER,",
        "  imported_at TEXT NOT NULL",
        ");",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_jsonl_source_line ON jsonl_records(stream, source_path, line_number);",
        "CREATE INDEX IF NOT EXISTS idx_jsonl_stream_id ON jsonl_records(stream, id);",
        "CREATE TABLE IF NOT EXISTS governance_state (",
        "  id INTEGER PRIMARY KEY CHECK (id = 1),",
        "  state_json TEXT NOT NULL,",
        "  updated_at TEXT NOT NULL",
        ");"
      ].join("\n")
    );
  }

  public getGovernanceStateRow(): GovernanceStateRow | null {
    const row = this.selectFirstRow(
      "SELECT state_json, updated_at FROM governance_state WHERE id = 1"
    );
    if (!row) {
      return null;
    }
    return {
      stateJson: this.decryptForRead(asString(row.state_json)),
      updatedAt: asString(row.updated_at)
    };
  }

  public upsertGovernanceStateRow(stateJson: string, updatedAt: string): void {
    this.executeRun(
      [
        "INSERT INTO governance_state(id, state_json, updated_at)",
        "VALUES (1, ?, ?)",
        "ON CONFLICT(id) DO UPDATE SET",
        "  state_json=excluded.state_json,",
        "  updated_at=excluded.updated_at"
      ].join("\n"),
      [this.encryptForWrite(stateJson), updatedAt]
    );
  }

  public upsertHistorySession(session: HistorySessionRecord): void {
    this.executeRun(
      [
        "INSERT INTO history_sessions(id, timestamp, topic, agents_json, entries_json, created_at)",
        "VALUES (?, ?, ?, ?, ?, ?)",
        "ON CONFLICT(id) DO UPDATE SET",
        "  timestamp=excluded.timestamp,",
        "  topic=excluded.topic,",
        "  agents_json=excluded.agents_json,",
        "  entries_json=excluded.entries_json"
      ].join("\n"),
      [
        session.id,
        session.timestamp,
        session.topic,
        this.encryptForWrite(JSON.stringify(session.agents ?? [])),
        this.encryptForWrite(JSON.stringify(session.entries ?? [])),
        new Date().toISOString()
      ]
    );
  }

  public listHistorySessions(limit?: number): HistorySessionRecord[] {
    const rows = limit && limit > 0
      ? this.selectRows(
          "SELECT id, timestamp, topic, agents_json, entries_json FROM history_sessions ORDER BY timestamp DESC LIMIT ?",
          [limit]
        )
      : this.selectRows("SELECT id, timestamp, topic, agents_json, entries_json FROM history_sessions ORDER BY timestamp DESC");

    return rows.map((row) => ({
      id: asString(row.id),
      timestamp: asString(row.timestamp),
      topic: asString(row.topic),
      agents: safeParseStringArray(this.decryptForRead(asString(row.agents_json))),
      entries: safeParseArray(this.decryptForRead(asString(row.entries_json)))
    }));
  }

  public getHistorySessionById(id: string): HistorySessionRecord | null {
    const row = this.selectFirstRow(
      "SELECT id, timestamp, topic, agents_json, entries_json FROM history_sessions WHERE id = ?",
      [id]
    );

    if (!row) {
      return null;
    }

    return {
      id: asString(row.id),
      timestamp: asString(row.timestamp),
      topic: asString(row.topic),
      agents: safeParseStringArray(this.decryptForRead(asString(row.agents_json))),
      entries: safeParseArray(this.decryptForRead(asString(row.entries_json)))
    };
  }

  public countHistorySessions(): number {
    const row = this.selectFirstRow("SELECT COUNT(*) as c FROM history_sessions");
    return row ? asNumber(row.c) : 0;
  }

  public deleteHistoryOlderThan(isoTimestamp: string): number {
    const changes = this.executeRun("DELETE FROM history_sessions WHERE timestamp < ?", [isoTimestamp]).changes;
    return changes;
  }

  public pruneHistoryMaxCount(maxRows: number): number {
    if (maxRows < 0) return 0;
    const changes = this.executeRun(
      [
        "DELETE FROM history_sessions",
        "WHERE id IN (",
        "  SELECT id FROM history_sessions",
        "  ORDER BY timestamp DESC",
        "  LIMIT -1 OFFSET ?",
        ")"
      ].join("\n"),
      [maxRows]
    ).changes;
    return changes;
  }

  public insertJsonlRecord(record: JsonlRecordInput): boolean {
    const changes = this.executeRun(
      [
        "INSERT OR IGNORE INTO jsonl_records(stream, payload, source_path, line_number, imported_at)",
        "VALUES (?, ?, ?, ?, ?)"
      ].join("\n"),
      [
        record.stream,
        this.encryptForWrite(record.payload),
        record.sourcePath ?? null,
        record.lineNumber ?? null,
        record.importedAt ?? new Date().toISOString()
      ]
    ).changes;
    const inserted = changes > 0;
    return inserted;
  }

  public listJsonlStreams(): string[] {
    return this.selectRows("SELECT DISTINCT stream FROM jsonl_records ORDER BY stream ASC").map((row) => asString(row.stream));
  }

  public listJsonlRecords(stream?: string): JsonlRecordRow[] {
    const rows = stream
      ? this.selectRows(
          "SELECT id, stream, payload, source_path, line_number, imported_at FROM jsonl_records WHERE stream = ? ORDER BY id ASC",
          [stream]
        )
      : this.selectRows("SELECT id, stream, payload, source_path, line_number, imported_at FROM jsonl_records ORDER BY id ASC");

    return rows.map((row) => ({
      id: asNumber(row.id),
      stream: asString(row.stream),
      payload: this.decryptForRead(asString(row.payload)),
      sourcePath: asNullableString(row.source_path),
      lineNumber: asNullableNumber(row.line_number),
      importedAt: asString(row.imported_at)
    }));
  }

  private encryptForWrite(value: string): string {
    if (!this.atRestCrypto) {
      return value;
    }
    return JSON.stringify(this.atRestCrypto.encryptUtf8(value));
  }

  private decryptForRead(value: string): string {
    if (!this.atRestCrypto) {
      return value;
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return value;
    }
    try {
      const parsed = parseEncryptedEnvelope(trimmed);
      if (!isEncryptedEnvelope(parsed)) {
        return value;
      }
      return this.atRestCrypto.decryptUtf8(parsed);
    } catch {
      return value;
    }
  }

  private selectRows(sql: string, params?: SqlBindParams): QueryRow[] {
    const statement = this.db.prepare(sql);
    return runStatementAll(statement, params);
  }

  private selectFirstRow(sql: string, params?: SqlBindParams): QueryRow | null {
    const statement = this.db.prepare(sql);
    const row = runStatementGet(statement, params);
    return row ?? null;
  }

  private executeRun(sql: string, params?: SqlBindParams): SqliteRunResult {
    const statement = this.db.prepare(sql);
    return runStatementRun(statement, params);
  }

  public get isTransactionActive(): boolean {
    return this.inTransaction;
  }
}

export function isSqliteDriverAvailable(): boolean {
  try {
    const probe = new DatabaseSync(":memory:");
    probe.exec("SELECT 1");
    probe.close();
    return true;
  } catch {
    return false;
  }
}

function runStatementRun(statement: StatementSync, params?: SqlBindParams): SqliteRunResult {
  if (params === undefined) {
    return statement.run() as SqliteRunResult;
  }
  if (Array.isArray(params)) {
    return statement.run(...params) as SqliteRunResult;
  }
  return statement.run(params) as SqliteRunResult;
}

function runStatementAll(statement: StatementSync, params?: SqlBindParams): QueryRow[] {
  if (params === undefined) {
    return statement.all() as QueryRow[];
  }
  if (Array.isArray(params)) {
    return statement.all(...params) as QueryRow[];
  }
  return statement.all(params) as QueryRow[];
}

function runStatementGet(statement: StatementSync, params?: SqlBindParams): QueryRow | undefined {
  if (params === undefined) {
    return statement.get() as QueryRow | undefined;
  }
  if (Array.isArray(params)) {
    return statement.get(...params) as QueryRow | undefined;
  }
  return statement.get(params) as QueryRow | undefined;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

function asNullableNumber(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function safeParseArray(value: string): unknown[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function safeParseStringArray(value: string): string[] {
  return safeParseArray(value).filter((item): item is string => typeof item === "string");
}
