import type { CliCommand } from "../types.js";

export const runtimeCommands: Record<string, CliCommand> = {
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
  }
};
