import { spawnSync } from "node:child_process";

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
  scaffold: {
    script: "scaffold",
    description: "agent/skill の雛形を生成",
    passThroughArgs: true
  }
};

function printUsage(error?: string): void {
  if (error) {
    console.error(`[ai-cli] ${error}`);
  }

  console.error("Usage: npm run ai -- <command> [args]");
  console.error("\nCommands:");

  for (const [name, command] of Object.entries(COMMANDS)) {
    console.error(`  ${name.padEnd(18)} ${command.description}`);
  }

  console.error("  help               このヘルプを表示");
  console.error("\nExamples:");
  console.error("  npm run ai -- dev");
  console.error("  npm run ai -- outputs:cleanup -- --dry-run");
}

function resolveNpmCommand(): string {
  return process.platform === "win32" ? "npm" : "npm";
}

function run(): number {
  const args = process.argv.slice(2);
  const commandName = args[0];

  if (!commandName || commandName === "help" || commandName === "--help" || commandName === "-h") {
    printUsage();
    return commandName ? 0 : 1;
  }

  const command = COMMANDS[commandName];
  if (!command) {
    printUsage(`Unknown command: ${commandName}`);
    return 1;
  }

  const npmArgs = ["run", command.script];
  const passThrough = args.slice(1);
  const normalizedPassThrough = passThrough[0] === "--" ? passThrough.slice(1) : passThrough;
  if (command.passThroughArgs && passThrough.length > 0) {
    npmArgs.push("--", ...normalizedPassThrough);
  } else if (!command.passThroughArgs && passThrough.length > 0) {
    printUsage(`Command '${commandName}' does not accept extra args: ${passThrough.join(" ")}`);
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
    console.error("[ai-cli] Failed to execute npm process:", result.error.message);
  } else {
    console.error("[ai-cli] Failed to execute npm process.");
  }
  return 1;
}

process.exit(run());
