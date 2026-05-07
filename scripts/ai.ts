import { spawnSync } from "node:child_process";
import { Command } from "commander";
import { readFileSync } from "node:fs";
import { renderCommandsTable, suggestClosestValue, formatError, formatWarn } from "./support/cli-output.js";
import { t } from "./support/i18n.js";

// package.json からバージョン情報を取得
let packageVersion = "1.0.0";
try {
  const pkg = JSON.parse(readFileSync("./package.json", "utf-8"));
  packageVersion = pkg.version || "1.0.0";
} catch {
  // デフォルトを使用
}

type CliCommand = {
  script: string;
  description: string;
  passThroughArgs?: boolean;
};

const COMMANDS: Record<string, CliCommand> = {
  dev: {
    script: "mcp:dev",
    description: "MCP サーバーを開発モードで起動"
  },
  start: {
    script: "mcp:start",
    description: "ビルド済み MCP サーバーを起動"
  },
  build: {
    script: "build",
    description: "TypeScript をビルド"
  },
  doctor: {
    script: "doctor",
    description: "設定・outputs・権限の診断"
  },
  init: {
    script: "init",
    description: "初期設定ファイルを生成"
  },
  "metrics:report": {
    script: "metrics:report",
    description: "メトリクス集計レポートを出力"
  },
  "metrics:snapshot": {
    script: "metrics:snapshot",
    description: "メトリクス公開用スナップショットを生成"
  },
  "metrics:dashboard": {
    script: "metrics:dashboard",
    description: "メトリクス可視化 HTML を生成"
  },
  "observability:dashboard": {
    script: "observability:dashboard",
    description: "trace/event/governance 統合ダッシュボードを生成",
    passThroughArgs: true
  },
  "history:archive": {
    script: "history:archive",
    description: "日別チャット履歴をアーカイブし要約を生成",
    passThroughArgs: true
  },
  "test:matrix": {
    script: "test:matrix",
    description: "ツールとテストの対応表を出力",
    passThroughArgs: true
  },
  "logs:remask": {
    script: "logs:remask",
    description: "既存ログのPIIを再マスク",
    passThroughArgs: true
  },
  "metrics:seed": {
    script: "metrics:seed",
    description: "サンプルメトリクスを投入"
  },
  "outputs:cleanup": {
    script: "outputs:cleanup",
    description: "outputs をクリーンアップ",
    passThroughArgs: true
  },
  "outputs:version": {
    script: "outputs:version",
    description: "outputs の世代バックアップ/復元",
    passThroughArgs: true
  },
  "learning:replay": {
    script: "learning:replay",
    description: "過去チャット履歴を再評価してレポート化",
    passThroughArgs: true
  },
  scaffold: {
    script: "scaffold",
    description: "agent/skill/preset/tool の雛形を生成",
    passThroughArgs: true
  }
};

function resolveNpmCommand(): string {
  return process.platform === "win32" ? "npm" : "npm";
}

function buildHelpText(): string {
  const table = renderCommandsTable([
    ...Object.entries(COMMANDS).map(([name, command]) => ({ name, description: command.description })),
    { name: "help", description: t("ai.help.helpCommand") }
  ]);
  return [
    `${t("ai.help.commandsTitle")}:`,
    table,
    "",
    `${t("ai.help.examplesTitle")}:`,
    "  npm run ai -- dev",
    "  npm run ai -- outputs:cleanup -- --dry-run",
    "  npm run ai -- observability:dashboard -- --trace-limit 100",
    "  npm run ai -- learning:replay -- --limit 20"
  ].join("\n");
}

function run(): number {
  const args = process.argv.slice(2);
  const commandName = args[0];

  // commander インスタンスを作成し、基本設定
  const program = new Command()
    .name("ai")
    .description(t("ai.description"))
    .version(packageVersion)
    .addHelpText("after", "\n" + buildHelpText());

  // グローバルオプション（--version / -V / --help / -h）の処理
  if (!commandName || commandName === "help" || commandName === "--help" || commandName === "-h") {
    program.outputHelp();
    return commandName && commandName !== "help" ? 0 : commandName === "help" ? 0 : 1;
  }

  if (commandName === "--version" || commandName === "-V") {
    console.log(packageVersion);
    return 0;
  }

  // コマンドをバリデート
  const command = COMMANDS[commandName];
  if (!command) {
    console.error(formatError(t("ai.errors.unknownCommand", { commandName })));
    const suggestion = suggestClosestValue(commandName, Object.keys(COMMANDS));
    if (suggestion) {
      console.error(formatWarn(t("ai.errors.unknownCommandSuggestion", { suggestion })));
    }
    console.error(formatWarn(t("ai.errors.unknownCommandHint")) + "\n");
    program.outputHelp();
    return 1;
  }

  // npm スクリプト実行
  const npmArgs = ["run", command.script];
  const passThrough = args.slice(1);
  const normalizedPassThrough = passThrough[0] === "--" ? passThrough.slice(1) : passThrough;

  if (command.passThroughArgs && passThrough.length > 0) {
    npmArgs.push("--", ...normalizedPassThrough);
  } else if (!command.passThroughArgs && passThrough.length > 0) {
    console.error(formatError(t("ai.errors.extraArgs", { commandName, args: passThrough.join(" ") })));
    return 1;
  }

  const result = spawnSync(resolveNpmCommand(), npmArgs, {
    stdio: "inherit",
    shell: process.platform === "win32"
  });

  if (typeof result.status === "number") {
    return result.status;
  }

  if (result.error) {
    console.error(formatError(t("ai.errors.spawnFailedWithMessage", { message: result.error.message })));
  } else {
    console.error(formatError(t("ai.errors.spawnFailed")));
  }
  return 1;
}

process.exit(run());
