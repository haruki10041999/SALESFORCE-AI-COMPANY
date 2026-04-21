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
}

export function createOrchestrationSessionStore<TSession extends OrchestrationSessionShape>(
  deps: CreateOrchestrationSessionStoreDeps<TSession>
) {
  const { sessionsDir, ensureDir, getSession, setSession, toRelativePosixPath } = deps;

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
    restoreOrchestrationSession
  };
}
