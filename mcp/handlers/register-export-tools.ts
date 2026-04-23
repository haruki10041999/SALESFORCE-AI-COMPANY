import { promises as fsPromises } from "fs";
import { dirname, resolve } from "path";
import { z } from "zod";
import type { GovTool } from "@mcp/tool-types.js";

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

interface RegisterExportToolsDeps {
  govTool: GovTool;
  agentLog: AgentMessage[];
  loadChatHistories: () => Promise<ChatSession[]>;
  ensureDir: (dir: string) => Promise<void>;
}

export function registerExportTools(deps: RegisterExportToolsDeps): void {
  const { govTool, agentLog, loadChatHistories, ensureDir } = deps;

  govTool(
    "export_to_markdown",
    {
      title: "Export Chat to Markdown",
      description: "Auto-generated description.",
      inputSchema: {
        historyId: z.string().optional(),
        title: z.string().optional(),
        outputPath: z.string().optional()
      }
    },
    async ({ historyId, title, outputPath }: { historyId?: string; title?: string; outputPath?: string }) => {
      const sessions = await loadChatHistories();
      let targetSession: ChatSession | undefined;

      if (historyId) {
        targetSession = sessions.find((session) => session.id === historyId);
      } else if (agentLog.length > 0) {
        targetSession = {
          id: "current",
          timestamp: new Date().toISOString(),
          topic: agentLog[0]?.topic ?? "Untitled",
          agents: [...new Set(agentLog.map((entry) => entry.agent))],
          entries: agentLog
        };
      }

      if (!targetSession) {
        return {
          content: [{ type: "text", text: "Export target session not found." }]
        };
      }

      const markdown =
        "# " + (title ?? targetSession.topic) + "\n\n" +
        "**��?E����E*: " + targetSession.timestamp + "  \n" +
        "**�Q���G�[�W�F���`E*: " + targetSession.agents.join(", ") + "  \n" +
        "**���`E??�[�W��**: " + targetSession.entries.length + "\n\n" +
        "---\n\n" +
        "## ��b?E??\n\n" +
        targetSession.entries.map((entry) => "### " + entry.agent + "\n\n" + entry.message + "\n").join("\n---\n\n") +
        "\n\n---\n\n" +
        "Salesforce AI Company MCP exported markdown.";

      if (outputPath) {
        const destination = resolve(outputPath);
        await ensureDir(dirname(destination));
        await fsPromises.writeFile(destination, markdown, "utf-8");
      }

      return {
        content: [
          {
            type: "text",
            text: markdown
          }
        ]
      };
    }
  );
}


