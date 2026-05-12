import { promises as fsPromises } from "fs";
import { dirname, resolve } from "path";
import { z } from "zod";
import type { ChatSession, RegisterExportToolsDeps } from "../register-export-tools.js";

function buildExportMarkdown(session: ChatSession, title?: string): string {
  return (
    "# " + (title ?? session.topic) + "\n\n" +
    "**作成日時**: " + session.timestamp + "  \n" +
    "**参加エージェント**: " + session.agents.join(", ") + "  \n" +
    "**メッセージ数**: " + session.entries.length + "\n\n" +
    "---\n\n" +
    "## 会話内容\n\n" +
    session.entries.map((entry) => "### " + entry.agent + "\n\n" + entry.message + "\n").join("\n---\n\n") +
    "\n\n---\n\n" +
    "Salesforce AI Company MCP exported markdown."
  );
}

export function defineExportToMarkdownTool(deps: RegisterExportToolsDeps): void {
  const { govTool, agentLog, loadChatHistories, ensureDir } = deps;

  govTool(
    "export_to_markdown",
    {
      title: "チャットをMarkdownへエクスポート",
      description: "チャット履歴をMarkdown形式でエクスポートします。",
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

      const markdown = buildExportMarkdown(targetSession, title);

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
