import { existsSync, promises as fsPromises } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

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

interface ArchiveResult {
  date: string;
  sessionCount: number;
  archiveJsonPath: string;
  summaryMdPath: string;
}

function parseArgs(argv: string[]): { date: string; outputsDir: string } {
  const dateArg = argv.find((arg) => arg.startsWith("--date="));
  const outputsArg = argv.find((arg) => arg.startsWith("--outputsDir="));

  const date = dateArg ? dateArg.slice("--date=".length) : getYesterdayDate();
  const outputsDir = outputsArg
    ? resolve(outputsArg.slice("--outputsDir=".length))
    : resolve(process.env.SF_AI_OUTPUTS_DIR ?? "outputs");

  return { date, outputsDir };
}

function getYesterdayDate(baseDate = new Date()): string {
  const d = new Date(baseDate);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function extractConclusion(entries: AgentMessage[]): string {
  const reversed = [...entries].reverse();
  const byKeyword = reversed.find((entry) => /結論|決定|合意|方針/i.test(entry.message));
  return byKeyword?.message ?? reversed[0]?.message ?? "結論は記録されていません。";
}

function extractNextActions(entries: AgentMessage[]): string[] {
  const actions = entries
    .filter((entry) => /次|todo|対応|action|課題|確認/i.test(entry.message))
    .slice(-3)
    .map((entry) => `${entry.agent}: ${entry.message}`);

  if (actions.length > 0) {
    return actions;
  }

  if (entries.length === 0) {
    return ["次アクションは記録されていません。"];
  }

  return [`${entries[entries.length - 1].agent}: ${entries[entries.length - 1].message}`];
}

function renderSummaryMarkdown(date: string, sessions: ChatSession[]): string {
  const lines: string[] = [];
  lines.push(`# Daily Chat Summary (${date})`);
  lines.push("");
  lines.push(`- Sessions: ${sessions.length}`);
  lines.push(`- GeneratedAt: ${new Date().toISOString()}`);
  lines.push("");

  for (const session of sessions) {
    lines.push(`## ${session.topic || session.id}`);
    lines.push("");
    lines.push(`- SessionId: ${session.id}`);
    lines.push(`- Timestamp: ${session.timestamp}`);
    lines.push(`- Agents: ${session.agents.join(", ") || "(none)"}`);
    lines.push(`- Messages: ${session.entries.length}`);
    lines.push("");
    lines.push("### Conclusion");
    lines.push("");
    lines.push(extractConclusion(session.entries));
    lines.push("");
    lines.push("### Next Actions");
    lines.push("");
    for (const action of extractNextActions(session.entries)) {
      lines.push(`- ${action}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

async function loadSessionsForDate(historyDir: string, date: string): Promise<ChatSession[]> {
  const dayDir = join(historyDir, date);
  if (!existsSync(dayDir)) {
    return [];
  }

  const files = await fsPromises.readdir(dayDir);
  const sessions: ChatSession[] = [];

  for (const file of files) {
    if (!file.endsWith(".json")) {
      continue;
    }

    try {
      const raw = await fsPromises.readFile(join(dayDir, file), "utf-8");
      sessions.push(JSON.parse(raw) as ChatSession);
    } catch {
      // ignore malformed history files
    }
  }

  return sessions.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

export async function archiveHistoryByDate(outputsDir: string, date: string): Promise<ArchiveResult> {
  const historyDir = join(outputsDir, "history");
  const archiveDir = join(historyDir, "archive");
  await fsPromises.mkdir(archiveDir, { recursive: true });

  const sessions = await loadSessionsForDate(historyDir, date);

  const archiveJsonPath = join(archiveDir, `${date}.json`);
  const summaryMdPath = join(archiveDir, `${date}-summary.md`);

  await fsPromises.writeFile(
    archiveJsonPath,
    JSON.stringify(
      {
        date,
        generatedAt: new Date().toISOString(),
        sessionCount: sessions.length,
        sessions
      },
      null,
      2
    ),
    "utf-8"
  );

  const summary = renderSummaryMarkdown(date, sessions);
  await fsPromises.writeFile(summaryMdPath, summary, "utf-8");

  return {
    date,
    sessionCount: sessions.length,
    archiveJsonPath,
    summaryMdPath
  };
}

async function main(): Promise<void> {
  const { date, outputsDir } = parseArgs(process.argv.slice(2));
  const result = await archiveHistoryByDate(outputsDir, date);
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        ok: true,
        ...result
      },
      null,
      2
    )
  );
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return import.meta.url === pathToFileURL(entry).href;
}

if (isDirectRun()) {
  main().catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error("[archive-history] failed", error);
    process.exitCode = 1;
  });
}
