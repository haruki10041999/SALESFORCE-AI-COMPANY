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
}

export function createHistoryStore(deps: CreateHistoryStoreDeps) {
  const { historyDir, ensureDir, agentLog } = deps;

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
    loadChatHistories,
    restoreChatHistory
  };
}
