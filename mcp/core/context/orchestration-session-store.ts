import { promises as fsPromises } from "fs";
import { join } from "path";

interface OrchestrationSessionShape {
  id: string;
  history: Array<unknown>;
}

interface CreateOrchestrationSessionStoreDeps<TSession extends OrchestrationSessionShape> {
  sessionsDir: string;
  ensureDir: (dir: string) => Promise<void>;
  getSession: (sessionId: string) => TSession | undefined;
  setSession: (session: TSession) => void;
  toRelativePosixPath: (absoluteFilePath: string) => string;
  maxSessionFiles?: number;
  retentionDays?: number;
}

export function createOrchestrationSessionStore<TSession extends OrchestrationSessionShape>(
  deps: CreateOrchestrationSessionStoreDeps<TSession>
) {
  const {
    sessionsDir,
    ensureDir,
    getSession,
    setSession,
    toRelativePosixPath,
    maxSessionFiles = 200,
    retentionDays = 30
  } = deps;

  async function deleteOldSessions(): Promise<{ deletedByAge: number; deletedByCount: number; remaining: number }> {
    await ensureDir(sessionsDir);

    const files = await fsPromises.readdir(sessionsDir);
    const sessions: Array<{ file: string; timestamp: number }> = [];
    for (const file of files) {
      if (!file.endsWith(".json")) {
        continue;
      }
      try {
        const raw = await fsPromises.readFile(join(sessionsDir, file), "utf-8");
        const parsed = JSON.parse(raw) as { id?: string };
        const derivedTimestamp = parsed.id
          ? new Date(parsed.id.replace(/^orch-/, "")).getTime()
          : 0;
        sessions.push({ file, timestamp: Number.isFinite(derivedTimestamp) ? derivedTimestamp : 0 });
      } catch {
        sessions.push({ file, timestamp: 0 });
      }
    }

    const ageThreshold = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    let deletedByAge = 0;
    for (const item of sessions) {
      if (item.timestamp > 0 && item.timestamp < ageThreshold) {
        try {
          await fsPromises.unlink(join(sessionsDir, item.file));
          deletedByAge += 1;
        } catch {
          // ignore delete failures
        }
      }
    }

    const remainingFiles = (await fsPromises.readdir(sessionsDir)).filter((file) => file.endsWith(".json"));
    const remaining: Array<{ file: string; timestamp: number }> = [];
    for (const file of remainingFiles) {
      try {
        const raw = await fsPromises.readFile(join(sessionsDir, file), "utf-8");
        const parsed = JSON.parse(raw) as { id?: string };
        const derivedTimestamp = parsed.id
          ? new Date(parsed.id.replace(/^orch-/, "")).getTime()
          : 0;
        remaining.push({ file, timestamp: Number.isFinite(derivedTimestamp) ? derivedTimestamp : 0 });
      } catch {
        remaining.push({ file, timestamp: 0 });
      }
    }

    remaining.sort((a, b) => b.timestamp - a.timestamp);
    const overflow = Math.max(0, remaining.length - maxSessionFiles);
    let deletedByCount = 0;
    if (overflow > 0) {
      for (const item of remaining.slice(-overflow)) {
        try {
          await fsPromises.unlink(join(sessionsDir, item.file));
          deletedByCount += 1;
        } catch {
          // ignore delete failures
        }
      }
    }

    return {
      deletedByAge,
      deletedByCount,
      remaining: Math.max(0, remaining.length - deletedByCount)
    };
  }

  async function saveOrchestrationSession(
    sessionId: string
  ): Promise<{ sessionId: string; filePath: string; historyCount: number } | null> {
    const session = getSession(sessionId);
    if (!session) {
      return null;
    }

    await ensureDir(sessionsDir);
    const filePath = join(sessionsDir, sessionId + ".json");
    await fsPromises.writeFile(filePath, JSON.stringify(session, null, 2), "utf-8");
    await deleteOldSessions();

    return {
      sessionId,
      filePath: toRelativePosixPath(filePath),
      historyCount: session.history.length
    };
  }

  async function restoreOrchestrationSession(sessionId: string): Promise<TSession | null> {
    const filePath = join(sessionsDir, sessionId + ".json");
    try {
      const content = await fsPromises.readFile(filePath, "utf-8");
      const session = JSON.parse(content) as TSession;
      setSession(session);
      return session;
    } catch {
      return null;
    }
  }

  return {
    saveOrchestrationSession,
    restoreOrchestrationSession,
    deleteOldSessions
  };
}
