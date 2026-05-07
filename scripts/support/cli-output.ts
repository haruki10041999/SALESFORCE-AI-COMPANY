import chalk from "chalk";
import { diffChars, createPatch } from "diff";
import Table from "cli-table3";
import ora, { type Ora } from "ora";
import cliProgress from "cli-progress";

interface ProgressBar {
  update(current: number): void;
  stop(): void;
}

export function formatError(message: string): string {
  return `${chalk.red("ERROR")} ${message}`;
}

export function formatWarn(message: string): string {
  return `${chalk.yellow("WARN")} ${message}`;
}

export function formatInfo(message: string): string {
  return `${chalk.cyan("INFO")} ${message}`;
}

export function formatSuccess(message: string): string {
  return `${chalk.green("OK")} ${message}`;
}

export function renderCommandsTable(rows: Array<{ name: string; description: string }>): string {
  const table = new Table({
    style: { head: [], border: [] },
    colWidths: [24, 72],
    wordWrap: true,
    chars: {
      top: "",
      "top-mid": "",
      "top-left": "",
      "top-right": "",
      bottom: "",
      "bottom-mid": "",
      "bottom-left": "",
      "bottom-right": "",
      left: "",
      "left-mid": "",
      mid: "",
      "mid-mid": "",
      right: "",
      "right-mid": "",
      middle: " "
    }
  });
  for (const row of rows) {
    table.push([chalk.bold(row.name), row.description]);
  }
  return table.toString();
}

export function suggestClosestValue(input: string, candidates: ReadonlyArray<string>): string | null {
  let best: { candidate: string; score: number } | null = null;
  for (const candidate of candidates) {
    const score = diffChars(input, candidate).reduce((sum, part) => {
      if (part.added || part.removed) return sum + part.count;
      return sum;
    }, 0);
    if (!best || score < best.score) {
      best = { candidate, score };
    }
  }
  if (!best) return null;
  return best.score <= Math.max(3, Math.floor(input.length / 2)) ? best.candidate : null;
}

export function createSpinner(text: string): Ora | null {
  if (!process.stdout.isTTY) return null;
  return ora({ text }).start();
}

export function createProgressBar(total: number): ProgressBar | null {
  if (!process.stdout.isTTY || total < 3) return null;
  const bar = new cliProgress.SingleBar(
    {
      hideCursor: true,
      format: "{bar} {percentage}% | {value}/{total} entries"
    },
    cliProgress.Presets.shades_classic
  );
  bar.start(total, 0);
  return bar;
}

export function renderJsonPatch(oldText: string, newText: string, fileName: string): string {
  return createPatch(fileName, oldText, newText, "before", "after");
}