import { spawnSync } from "node:child_process";
import { Command } from "commander";
import { readFileSync } from "node:fs";
import { renderCommandsTable, suggestClosestValue, formatError, formatWarn } from "./support/cli-output.js";
import { t } from "./support/i18n.js";
import { CLI_EXAMPLES, COMMANDS } from "./cli/index.js";

// package.json からバージョン情報を取得
let packageVersion = "1.0.0";
try {
  const pkg = JSON.parse(readFileSync("./package.json", "utf-8"));
  packageVersion = pkg.version || "1.0.0";
} catch {
  // デフォルトを使用
}

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
    "Legacy note: scripts/* の直接実行は将来的に非推奨です。統一 CLI (`npm run ai -- ...` / `sf-ai ...`) を利用してください。",
    "",
    `${t("ai.help.examplesTitle")}:`,
    ...CLI_EXAMPLES
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
