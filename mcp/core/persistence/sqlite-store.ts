import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import initSqlJs from "sql.js";

type SqlScalar = number | string | Uint8Array | null;
type SqlBindParams = SqlScalar[] | Record<string, SqlScalar> | null | undefined;

interface SqlStatement {
  step(): boolean;
  getAsObject(params?: SqlBindParams): Record<string, SqlScalar>;
  free(): boolean;
}

interface SqlDatabase {
  close(): void;
  prepare(sql: string, params?: SqlBindParams): SqlStatement;
  run(sql: string, params?: SqlBindParams): SqlDatabase;
  export(): Uint8Array;
  getRowsModified(): number;
}

interface SqlJsModule {
  Database: new (data?: ArrayLike<number> | null) => SqlDatabase;
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

export interface SQLiteStateStoreOptions {
  dbPath: string;
}

export const DEFAULT_SQLITE_STATE_FILE = "state.sqlite";

type QueryRow = Record<string, SqlScalar>;

let sqlJsModulePromise: Promise<SqlJsModule> | null = null;

function ensureParentDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export class SQLiteStateStore {
  private readonly db: SqlDatabase;
  private readonly dbPath: string;
  private inTransaction = false;

  private constructor(dbPath: string, db: SqlDatabase) {
    this.dbPath = dbPath;
    this.db = db;
    this.initSchema();
  }

  public static async open(options: SQLiteStateStoreOptions): Promise<SQLiteStateStore> {
    const dbPath = resolve(options.dbPath);
    ensureParentDir(dbPath);
    const SQL = await getSqlJsModule();
    const db = existsSync(dbPath) ? new SQL.Database(readFileSync(dbPath)) : new SQL.Database();
    return new SQLiteStateStore(dbPath, db);
  }

  public get path(): string {
    return this.dbPath;
  }

  public close(): void {
    this.persist();
    this.db.close();
  }

  public executeInTransaction<T>(work: () => T): T {
    this.db.run("BEGIN");
    this.inTransaction = true;
    try {
      const result = work();
      this.db.run("COMMIT");
      this.inTransaction = false;
      this.persist();
      return result;
    } catch (error) {
      this.db.run("ROLLBACK");
      this.inTransaction = false;
      throw error;
    }
  }

  private initSchema(): void {
    this.db.run(
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
        "CREATE INDEX IF NOT EXISTS idx_jsonl_stream_id ON jsonl_records(stream, id);"
      ].join("\n")
    );
    this.persist();
  }

  public upsertHistorySession(session: HistorySessionRecord): void {
    this.db.run(
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
        JSON.stringify(session.agents ?? []),
        JSON.stringify(session.entries ?? []),
        new Date().toISOString()
      ]
    );
    this.persistIfNeeded();
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
      agents: safeParseStringArray(asString(row.agents_json)),
      entries: safeParseArray(asString(row.entries_json))
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
      agents: safeParseStringArray(asString(row.agents_json)),
      entries: safeParseArray(asString(row.entries_json))
    };
  }

  public countHistorySessions(): number {
    const row = this.selectFirstRow("SELECT COUNT(*) as c FROM history_sessions");
    return row ? asNumber(row.c) : 0;
  }

  public deleteHistoryOlderThan(isoTimestamp: string): number {
    this.db.run("DELETE FROM history_sessions WHERE timestamp < ?", [isoTimestamp]);
    const changes = this.db.getRowsModified();
    this.persistIfNeeded();
    return changes;
  }

  public pruneHistoryMaxCount(maxRows: number): number {
    if (maxRows < 0) return 0;
    this.db.run(
      [
        "DELETE FROM history_sessions",
        "WHERE id IN (",
        "  SELECT id FROM history_sessions",
        "  ORDER BY timestamp DESC",
        "  LIMIT -1 OFFSET ?",
        ")"
      ].join("\n"),
      [maxRows]
    );
    const changes = this.db.getRowsModified();
    this.persistIfNeeded();
    return changes;
  }

  public insertJsonlRecord(record: JsonlRecordInput): boolean {
    this.db.run(
      [
        "INSERT OR IGNORE INTO jsonl_records(stream, payload, source_path, line_number, imported_at)",
        "VALUES (?, ?, ?, ?, ?)"
      ].join("\n"),
      [
        record.stream,
        record.payload,
        record.sourcePath ?? null,
        record.lineNumber ?? null,
        record.importedAt ?? new Date().toISOString()
      ]
    );
    const inserted = this.db.getRowsModified() > 0;
    this.persistIfNeeded();
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
      payload: asString(row.payload),
      sourcePath: asNullableString(row.source_path),
      lineNumber: asNullableNumber(row.line_number),
      importedAt: asString(row.imported_at)
    }));
  }

  private persistIfNeeded(): void {
    if (!this.inTransaction) {
      this.persist();
    }
  }

  private persist(): void {
    writeFileSync(this.dbPath, this.db.export());
  }

  private selectRows(sql: string, params?: SqlBindParams): QueryRow[] {
    const statement = this.db.prepare(sql, params);
    try {
      const rows: QueryRow[] = [];
      while (statement.step()) {
        rows.push(statement.getAsObject());
      }
      return rows;
    } finally {
      statement.free();
    }
  }

  private selectFirstRow(sql: string, params?: SqlBindParams): QueryRow | null {
    const statement = this.db.prepare(sql, params);
    try {
      return statement.step() ? statement.getAsObject() : null;
    } finally {
      statement.free();
    }
  }
}

export function isSqliteDriverAvailable(): boolean {
  const req = createRequire(import.meta.url);
  try {
    req.resolve("sql.js");
    req.resolve("sql.js/dist/sql-wasm.wasm");
    return true;
  } catch {
    return false;
  }
}

async function getSqlJsModule(): Promise<SqlJsModule> {
  if (!sqlJsModulePromise) {
    const req = createRequire(import.meta.url);
    const wasmPath = req.resolve("sql.js/dist/sql-wasm.wasm");
    const wasmBinaryView = readFileSync(wasmPath);
    const wasmBinary = wasmBinaryView.buffer.slice(
      wasmBinaryView.byteOffset,
      wasmBinaryView.byteOffset + wasmBinaryView.byteLength
    );
    sqlJsModulePromise = initSqlJs({ wasmBinary }) as Promise<SqlJsModule>;
  }
  return sqlJsModulePromise;
}

function asString(value: SqlScalar | undefined): string {
  return typeof value === "string" ? value : "";
}

function asNullableString(value: SqlScalar | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: SqlScalar | undefined): number {
  return typeof value === "number" ? value : 0;
}

function asNullableNumber(value: SqlScalar | undefined): number | null {
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
