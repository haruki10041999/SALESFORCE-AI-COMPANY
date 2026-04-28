import { existsSync, promises as fsPromises } from "fs";
import { join } from "path";
import {
  DEFAULT_SQLITE_STATE_FILE,
  SQLiteStateStore,
  isSqliteDriverAvailable,
  type HistorySessionRecord
} from "../persistence/sqlite-store.js";
import { FileUnitOfWork } from "../persistence/unit-of-work.js";

export interface AgentMessage {
  agent: string;
  message: string;
  timestamp: string;
  topic?: string;
}

export interface ChatSession {
  id: string;
  timestamp: string;
  topic: string;
  agents: string[];
  entries: AgentMessage[];
}

interface CreateHistoryStoreDeps {
  historyDir: string;
  ensureDir: (dir: string) => Promise<void>;
  agentLog: AgentMessage[];
  maxHistoryFiles?: number;
  retentionDays?: number;
  sqlite?: {
    enabled?: boolean;
    dbPath?: string;
  };
}

export function createHistoryStore(deps: CreateHistoryStoreDeps) {
  const {
    historyDir,
    ensureDir,
    agentLog,
    maxHistoryFiles = 200,
    retentionDays = 30,
    sqlite
  } = deps;
  const sqliteEnabled = sqlite?.enabled === true && isSqliteDriverAvailable();
  const sqliteDbPath = sqlite?.dbPath ?? join(historyDir, "..", DEFAULT_SQLITE_STATE_FILE);
  let sqliteStorePromise: Promise<SQLiteStateStore> | null = null;

  async function getSqliteStore(): Promise<SQLiteStateStore> {
    if (!sqliteStorePromise) {
      sqliteStorePromise = SQLiteStateStore.open({ dbPath: sqliteDbPath });
    }
    return sqliteStorePromise;
  }

  function toDayFolder(isoTimestamp: string): string {
    return isoTimestamp.slice(0, 10);
  }

  async function collectHistoryJsonFiles(dir: string): Promise<string[]> {
    if (!existsSync(dir)) {
      return [];
    }

    const entries = await fsPromises.readdir(dir, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...await collectHistoryJsonFiles(fullPath));
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".json")) {
        files.push(fullPath);
      }
    }

    return files;
  }

  async function deleteOldHistories(): Promise<{ deletedByAge: number; deletedByCount: number; remaining: number }> {
    if (sqliteEnabled) {
      return deleteOldHistoriesSqlite(await getSqliteStore(), maxHistoryFiles, retentionDays);
    }

    if (!existsSync(historyDir)) {
      return { deletedByAge: 0, deletedByCount: 0, remaining: 0 };
    }

    const files = await collectHistoryJsonFiles(historyDir);
    const sessions: Array<{ file: string; timestamp: number }> = [];

    for (const file of files) {
      try {
        const raw = await fsPromises.readFile(file, "utf-8");
        const parsed = JSON.parse(raw) as { timestamp?: string };
        const ts = parsed.timestamp ? new Date(parsed.timestamp).getTime() : 0;
        sessions.push({ file, timestamp: Number.isFinite(ts) ? ts : 0 });
      } catch {
        // ignore unreadable files for retention calculation
      }
    }

    const now = Date.now();
    const ageThreshold = now - retentionDays * 24 * 60 * 60 * 1000;
    let deletedByAge = 0;

    for (const item of sessions) {
      if (item.timestamp > 0 && item.timestamp < ageThreshold) {
        try {
          await fsPromises.unlink(item.file);
          deletedByAge += 1;
        } catch {
          // ignore delete failures
        }
      }
    }

    const remainingFiles = await collectHistoryJsonFiles(historyDir);
    const remainingSessions: Array<{ file: string; timestamp: number }> = [];
    for (const file of remainingFiles) {
      try {
        const raw = await fsPromises.readFile(file, "utf-8");
        const parsed = JSON.parse(raw) as { timestamp?: string };
        const ts = parsed.timestamp ? new Date(parsed.timestamp).getTime() : 0;
        remainingSessions.push({ file, timestamp: Number.isFinite(ts) ? ts : 0 });
      } catch {
        remainingSessions.push({ file, timestamp: 0 });
      }
    }

    remainingSessions.sort((a, b) => b.timestamp - a.timestamp);
    const overflow = Math.max(0, remainingSessions.length - maxHistoryFiles);
    let deletedByCount = 0;

    if (overflow > 0) {
      for (const item of remainingSessions.slice(-overflow)) {
        try {
          await fsPromises.unlink(item.file);
          deletedByCount += 1;
        } catch {
          // ignore delete failures
        }
      }
    }

    return {
      deletedByAge,
      deletedByCount,
      remaining: Math.max(0, remainingSessions.length - deletedByCount)
    };
  }

  async function saveChatHistory(topic: string): Promise<string> {
    const nowIso = new Date().toISOString();
    const timestamp = nowIso.replace(/[:.]/g, "-");
    const id = timestamp.split("T")[0] + "-" + timestamp.split("T")[1].slice(0, 6);

    const session: ChatSession = {
      id,
      timestamp: nowIso,
      topic,
      agents: [...new Set(agentLog.map((e) => e.agent))],
      entries: agentLog.filter((e) => e.topic === topic || !e.topic)
    };

    if (sqliteEnabled) {
      const store = await getSqliteStore();
      store.executeInTransaction(() => {
        store.upsertHistorySession(sessionToRecord(session));
        deleteOldHistoriesSqlite(store, maxHistoryFiles, retentionDays);
      });
    } else {
      const dayDir = join(historyDir, toDayFolder(nowIso));
      const filePath = join(dayDir, id + ".json");
      const unitOfWork = new FileUnitOfWork();
      await ensureDir(historyDir);
      await ensureDir(dayDir);
      await unitOfWork.stageFileWrite(filePath, JSON.stringify(session, null, 2));
      await unitOfWork.commit();
      await deleteOldHistories();
      return id;
    }

    return id;
  }

  async function saveSessionHistory(topic: string, entries: AgentMessage[]): Promise<string> {
    const nowIso = new Date().toISOString();
    const timestamp = nowIso.replace(/[:.]/g, "-");
    const id = timestamp.split("T")[0] + "-" + timestamp.split("T")[1].slice(0, 6);

    const session: ChatSession = {
      id,
      timestamp: nowIso,
      topic,
      agents: [...new Set(entries.map((e) => e.agent))],
      entries
    };

    if (sqliteEnabled) {
      const store = await getSqliteStore();
      store.executeInTransaction(() => {
        store.upsertHistorySession(sessionToRecord(session));
        deleteOldHistoriesSqlite(store, maxHistoryFiles, retentionDays);
      });
    } else {
      const dayDir = join(historyDir, toDayFolder(nowIso));
      const filePath = join(dayDir, id + ".json");
      const unitOfWork = new FileUnitOfWork();
      await ensureDir(historyDir);
      await ensureDir(dayDir);
      await unitOfWork.stageFileWrite(filePath, JSON.stringify(session, null, 2));
      await unitOfWork.commit();
      await deleteOldHistories();
      return id;
    }

    return id;
  }

  async function loadChatHistories(): Promise<ChatSession[]> {
    if (sqliteEnabled) {
      const store = await getSqliteStore();
      return store.listHistorySessions().map(recordToSession);
    }

    if (!existsSync(historyDir)) {
      return [];
    }

    const files = await collectHistoryJsonFiles(historyDir);
    const sessions: ChatSession[] = [];

    for (const file of files) {
      try {
        const content = await fsPromises.readFile(file, "utf-8");
        sessions.push(JSON.parse(content));
      } catch {
        // skip corrupted files
      }
    }

    return sessions.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  async function restoreChatHistory(id: string): Promise<ChatSession | null> {
    if (sqliteEnabled) {
      const store = await getSqliteStore();
      const session = store.getHistorySessionById(id);
      if (!session) {
        return null;
      }
      const mapped = recordToSession(session);
      agentLog.length = 0;
      agentLog.push(...mapped.entries);
      return mapped;
    }

    const dayPrefix = id.slice(0, 10);
    const candidatePaths = [
      join(historyDir, dayPrefix, id + ".json"),
      join(historyDir, id + ".json")
    ];

    let filePath = candidatePaths.find((candidate) => existsSync(candidate));
    if (!filePath) {
      const files = await collectHistoryJsonFiles(historyDir);
      filePath = files.find((pathValue) => pathValue.endsWith(`\\${id}.json`) || pathValue.endsWith(`/${id}.json`));
    }

    if (!filePath) {
      return null;
    }

    try {
      const content = await fsPromises.readFile(filePath, "utf-8");
      const session = JSON.parse(content) as ChatSession;
      agentLog.length = 0;
      agentLog.push(...session.entries);
      return session;
    } catch {
      return null;
    }
  }

  async function close(): Promise<void> {
    if (!sqliteStorePromise) {
      return;
    }
    const store = await sqliteStorePromise;
    store.close();
    sqliteStorePromise = null;
  }

  return {
    saveChatHistory,
    saveSessionHistory,
    loadChatHistories,
    restoreChatHistory,
    deleteOldHistories,
    close
  };
}

function deleteOldHistoriesSqlite(store: SQLiteStateStore, maxHistoryFiles = 200, retentionDays = 30): {
  deletedByAge: number;
  deletedByCount: number;
  remaining: number;
} {
  const ageThreshold = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const deletedByAge = store.deleteHistoryOlderThan(ageThreshold);
  const deletedByCount = store.pruneHistoryMaxCount(maxHistoryFiles);
  return {
    deletedByAge,
    deletedByCount,
    remaining: store.countHistorySessions()
  };
}

function sessionToRecord(session: ChatSession): HistorySessionRecord {
  return {
    id: session.id,
    timestamp: session.timestamp,
    topic: session.topic,
    agents: session.agents,
    entries: session.entries
  };
}

function recordToSession(record: HistorySessionRecord): ChatSession {
  const entries = (record.entries ?? []).map((entry) => {
    const value = entry as Partial<AgentMessage>;
    return {
      agent: typeof value.agent === "string" ? value.agent : "unknown",
      message: typeof value.message === "string" ? value.message : "",
      timestamp: typeof value.timestamp === "string" ? value.timestamp : new Date().toISOString(),
      ...(typeof value.topic === "string" ? { topic: value.topic } : {})
    };
  });
  return {
    id: record.id,
    timestamp: record.timestamp,
    topic: record.topic,
    agents: record.agents,
    entries
  };
}
