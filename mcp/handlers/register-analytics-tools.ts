import { promises as fsPromises } from "fs";
import { dirname, resolve } from "path";
import { z } from "zod";

type GovTool = (name: string, config: any, handler: any) => void;

interface AgentMessage {
  agent: string;
  message: string;
  timestamp: string;
  topic?: string;
}

interface ChatSession {
  id: string;
  timestamp: string;
  topic: string;
  agents: string[];
  entries: AgentMessage[];
}

interface HandlersStateShape {
  createdTracker: unknown;
  deletedTracker: unknown;
  errorTracker: unknown;
  qualityTracker: unknown;
}

interface HandlersStatisticsShape {
  created: unknown;
  deleted: unknown;
  errors: unknown;
  qualityFailures: unknown;
  lastUpdated: string;
}

interface RegisterAnalyticsToolsDeps {
  govTool: GovTool;
  agentLog: AgentMessage[];
  loadChatHistories: () => Promise<ChatSession[]>;
  generateHandlersDashboard: (state: HandlersStateShape) => unknown;
  handlersState: HandlersStateShape;
  exportStatisticsAsCsv: (stats: HandlersStatisticsShape) => string;
  exportStatisticsAsJson: (stats: HandlersStatisticsShape) => string;
  ensureDir: (dir: string) => Promise<void>;
}

export function registerAnalyticsTools(deps: RegisterAnalyticsToolsDeps): void {
  const {
    govTool,
    agentLog,
    loadChatHistories,
    generateHandlersDashboard,
    handlersState,
    exportStatisticsAsCsv,
    exportStatisticsAsJson,
    ensureDir
  } = deps;

  govTool(
    "analyze_chat_trends",
    {
      title: "Analyze Chat Trends",
      description: "エージェントログの傾向を分析します。historyId で特定セッション、since で期間絞り込み、groupBy でグループ化方法を指定できます。",
      inputSchema: {
        historyId: z.string().optional(),
        since: z.string().optional(),
        groupBy: z.enum(["agent", "topic"]).optional()
      }
    },
    async ({ historyId, since, groupBy }: { historyId?: string; since?: string; groupBy?: "agent" | "topic" }) => {
      let targetEntries: AgentMessage[] = agentLog;

      if (historyId) {
        const session = await loadChatHistories().then((sessions) => sessions.find((entry) => entry.id === historyId));
        if (!session) {
          return { content: [{ type: "text", text: `History not found: ${historyId}` }] };
        }
        targetEntries = session.entries;
      }

      if (since) {
        const cutoff = new Date(since);
        targetEntries = targetEntries.filter((entry) => new Date(entry.timestamp) >= cutoff);
      }

      const key = groupBy ?? "agent";
      const stats: Record<string, { count: number; avgLength: number; topics?: string[]; agents?: string[] }> = {};

      for (const entry of targetEntries) {
        const groupName = key === "topic" ? (entry.topic ?? "unknown") : entry.agent;
        if (!stats[groupName]) {
          stats[groupName] = { count: 0, avgLength: 0, ...(key === "agent" ? { topics: [] } : { agents: [] }) };
        }
        stats[groupName].count++;
        const previousAverage = stats[groupName].avgLength;
        stats[groupName].avgLength = previousAverage + (entry.message.length - previousAverage) / stats[groupName].count;
        if (key === "agent" && entry.topic && !stats[groupName].topics!.includes(entry.topic)) {
          stats[groupName].topics!.push(entry.topic);
        }
        if (key === "topic" && !stats[groupName].agents!.includes(entry.agent)) {
          stats[groupName].agents!.push(entry.agent);
        }
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                totalMessages: targetEntries.length,
                uniqueGroups: Object.keys(stats).length,
                groupBy: key,
                historyId: historyId ?? "current",
                since: since ?? null,
                stats
              },
              null,
              2
            )
          }
        ]
      };
    }
  );

  govTool(
    "get_handlers_dashboard",
    {
      title: "Get Handlers Dashboard",
      description: "イベントハンドラーの稼働統計を返します。",
      inputSchema: {}
    },
    async () => {
      const dashboard = generateHandlersDashboard(handlersState);
      return {
        content: [{ type: "text", text: JSON.stringify(dashboard, null, 2) }]
      };
    }
  );

  govTool(
    "export_handlers_statistics",
    {
      title: "Export Handlers Statistics",
      description: "ハンドラー統計を CSV または JSON 形式でエクスポートします。outputPath を指定するとファイルにも書き出します。",
      inputSchema: {
        format: z.enum(["json", "csv"]).optional(),
        outputPath: z.string().optional()
      }
    },
    async ({ format, outputPath }: { format?: "json" | "csv"; outputPath?: string }) => {
      const stats: HandlersStatisticsShape = {
        created: handlersState.createdTracker,
        deleted: handlersState.deletedTracker,
        errors: handlersState.errorTracker,
        qualityFailures: handlersState.qualityTracker,
        lastUpdated: new Date().toISOString()
      };
      const content = format === "csv"
        ? exportStatisticsAsCsv(stats)
        : exportStatisticsAsJson(stats);

      if (outputPath) {
        const destination = resolve(outputPath);
        await ensureDir(dirname(destination));
        await fsPromises.writeFile(destination, content, "utf-8");
      }

      return { content: [{ type: "text", text: content }] };
    }
  );
}