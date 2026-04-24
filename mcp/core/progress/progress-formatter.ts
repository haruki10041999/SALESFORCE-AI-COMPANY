import { findTrace, getActiveTraces, getCompletedTraces, type TraceEntry } from "../trace/trace-context.js";

/**
 * 進捗バナー用フォーマッタ。
 * trace の phases / startedAt / endedAt を元に、ユーザーが MCP クライアントの応答テキスト内で
 * 「いつ何が動いたか」を一目で把握できる Markdown を生成する。
 */

const PHASE_LABEL: Record<string, string> = {
  input: "入力検査",
  plan: "計画策定",
  execute: "本処理",
  render: "出力生成"
};

function fmtPhaseName(name: string): string {
  return PHASE_LABEL[name] ?? name;
}

function fmtMs(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return "-";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function statusEmoji(status: string | undefined): string {
  if (status === "success") return "OK";
  if (status === "error") return "NG";
  if (status === "running") return "..";
  return "--";
}

export interface ProgressBannerOptions {
  /** バナータイトル。未指定なら「進捗」 */
  title?: string;
  /** 末尾に追加表示する任意のメタ情報 */
  extraLines?: string[];
  /** 進捗が空 (phases なし) でも空のバナーを返すか。既定 false で空文字列 */
  emitWhenEmpty?: boolean;
}

export function buildProgressBanner(traceId: string, options: ProgressBannerOptions = {}): string {
  const trace = findTrace(traceId);
  if (!trace) {
    return options.emitWhenEmpty ? `## 進捗 (trace: ${traceId})\n\n_trace 情報が見つかりません_\n\n---\n\n` : "";
  }

  const phases = trace.phases ?? [];
  if (phases.length === 0 && !options.emitWhenEmpty) {
    return "";
  }

  const startMs = new Date(trace.startedAt).getTime();
  const lines: string[] = [];
  lines.push(`## ${options.title ?? "進捗タイムライン"} (${trace.toolName})`);
  lines.push("");
  lines.push(`- traceId: \`${trace.traceId}\``);
  lines.push(`- 開始: ${trace.startedAt}`);
  if (trace.endedAt) {
    lines.push(`- 終了: ${trace.endedAt}`);
  }
  if (typeof trace.durationMs === "number") {
    lines.push(`- 総所要時間: ${fmtMs(trace.durationMs)}`);
  }
  if (options.extraLines) {
    for (const extra of options.extraLines) lines.push(`- ${extra}`);
  }
  lines.push("");

  if (phases.length > 0) {
    lines.push("| # | フェーズ | 状態 | 開始 (+ms) | 所要 |");
    lines.push("|---|----------|------|-----------|------|");
    phases.forEach((phase, idx) => {
      const offsetMs = new Date(phase.startedAt).getTime() - startMs;
      lines.push(
        `| ${idx + 1} | ${fmtPhaseName(phase.name)} | ${statusEmoji(phase.status)} ${phase.status} | +${offsetMs}ms | ${fmtMs(phase.durationMs)} |`
      );
    });
  }

  lines.push("");
  lines.push("---");
  lines.push("");
  return lines.join("\n");
}

/**
 * `get_tool_progress` ツール用の現状一覧を返す
 */
export function describeRecentTraces(limit = 20): string {
  const active = getActiveTraces();
  const completed = getCompletedTraces(limit);

  const lines: string[] = [];
  lines.push(`## 進行中のツール (${active.length})`);
  lines.push("");
  if (active.length === 0) {
    lines.push("_進行中のツールはありません_");
  } else {
    lines.push("| traceId | tool | 開始 | 経過 | 現在のフェーズ |");
    lines.push("|---------|------|------|------|----------------|");
    const now = Date.now();
    for (const trace of active) {
      const elapsed = now - new Date(trace.startedAt).getTime();
      const running = (trace.phases ?? []).find((p) => p.status === "running");
      lines.push(
        `| \`${trace.traceId}\` | ${trace.toolName} | ${trace.startedAt} | ${fmtMs(elapsed)} | ${running ? fmtPhaseName(running.name) : "-"} |`
      );
    }
  }

  lines.push("");
  lines.push(`## 直近完了 (${completed.length})`);
  lines.push("");
  if (completed.length === 0) {
    lines.push("_完了済みトレースはありません_");
  } else {
    lines.push("| traceId | tool | 結果 | 所要 | 終了 |");
    lines.push("|---------|------|------|------|------|");
    for (const trace of completed) {
      const status = trace.status ?? "-";
      lines.push(
        `| \`${trace.traceId}\` | ${trace.toolName} | ${statusEmoji(status)} ${status} | ${fmtMs(trace.durationMs)} | ${trace.endedAt ?? "-"} |`
      );
    }
  }

  return lines.join("\n");
}

export type { TraceEntry };
