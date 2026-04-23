import { existsSync, promises as fsPromises } from "fs";
import { join } from "path";

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
}

export function createHistoryStore(deps: CreateHistoryStoreDeps) {
  const {
    historyDir,
    ensureDir,
    agentLog,
    maxHistoryFiles = 200,
    retentionDays = 30
  } = deps;

  async function deleteOldHistories(): Promise<{ deletedByAge: number; deletedByCount: number; remaining: number }> {
    if (!existsSync(historyDir)) {
      return { deletedByAge: 0, deletedByCount: 0, remaining: 0 };
    }

    const files = await fsPromises.readdir(historyDir);
    const sessions: Array<{ file: string; timestamp: number }> = [];

    for (const file of files) {
      if (!file.endsWith(".json")) {
        continue;
      }

      try {
        const raw = await fsPromises.readFile(join(historyDir, file), "utf-8");
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
          await fsPromises.unlink(join(historyDir, item.file));
          deletedByAge += 1;
        } catch {
          // ignore delete failures
        }
      }
    }

    const remainingFiles = (await fsPromises.readdir(historyDir)).filter((file) => file.endsWith(".json"));
    const remainingSessions: Array<{ file: string; timestamp: number }> = [];
    for (const file of remainingFiles) {
      try {
        const raw = await fsPromises.readFile(join(historyDir, file), "utf-8");
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

    for (const item of remainingSessions.slice(-overflow)) {
      try {
        await fsPromises.unlink(join(historyDir, item.file));
        deletedByCount += 1;
      } catch {
        // ignore delete failures
      }
    }

    return {
      deletedByAge,
      deletedByCount,
      remaining: Math.max(0, remainingSessions.length - deletedByCount)
    };
  }

  async function saveChatHistory(topic: string): Promise<string> {
    await ensureDir(historyDir);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const id = timestamp.split("T")[0] + "-" + timestamp.split("T")[1].slice(0, 6);

    const session: ChatSession = {
      id,
      timestamp: new Date().toISOString(),
      topic,
      agents: [...new Set(agentLog.map((e) => e.agent))],
      entries: agentLog.filter((e) => e.topic === topic || !e.topic)
    };

    const filePath = join(historyDir, id + ".json");
    await fsPromises.writeFile(filePath, JSON.stringify(session, null, 2));
    await deleteOldHistories();

    return id;
  }

  async function saveSessionHistory(topic: string, entries: AgentMessage[]): Promise<string> {
    await ensureDir(historyDir);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const id = timestamp.split("T")[0] + "-" + timestamp.split("T")[1].slice(0, 6);

    const session: ChatSession = {
      id,
      timestamp: new Date().toISOString(),
      topic,
      agents: [...new Set(entries.map((e) => e.agent))],
      entries
    };

    const filePath = join(historyDir, id + ".json");
    await fsPromises.writeFile(filePath, JSON.stringify(session, null, 2));
    await deleteOldHistories();

    return id;
  }

  async function loadChatHistories(): Promise<ChatSession[]> {
    if (!existsSync(historyDir)) {
      return [];
    }

    const files = await fsPromises.readdir(historyDir);
    const sessions: ChatSession[] = [];

    for (const file of files) {
      if (file.endsWith(".json")) {
        try {
          const content = await fsPromises.readFile(join(historyDir, file), "utf-8");
          sessions.push(JSON.parse(content));
        } catch {
          // skip corrupted files
        }
      }
    }

    return sessions.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }

  async function restoreChatHistory(id: string): Promise<ChatSession | null> {
    const filePath = join(historyDir, id + ".json");
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

  return {
    saveChatHistory,
    saveSessionHistory,
    loadChatHistories,
    restoreChatHistory,
    deleteOldHistories
  };
}
