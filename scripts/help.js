#!/usr/bin/env node
/**
 * help.js — npm run help で日常使いコマンドを表示します。
 */

const BOLD  = "\x1b[1m";
const CYAN  = "\x1b[36m";
const GREEN = "\x1b[32m";
const DIM   = "\x1b[2m";
const RESET = "\x1b[0m";

const COMMANDS = [
  { cmd: "npm run init",             desc: "初回セットアップ（.env 雛形・git フック・outputs/ 作成）" },
  { cmd: "npm run doctor",           desc: "運用健全性診断（環境・ビルド・Ollama 接続を確認）" },
  { cmd: "npm run sf -- <command>",  desc: "Salesforce CLI ラッパー（org:list / deploy / test 等）" },
  { cmd: "npm run build",            desc: "TypeScript → dist/ へコンパイル" },
  { cmd: "npm run mcp:start",        desc: "MCPサーバー起動（本番: dist/mcp/server.js）" },
  { cmd: "npm run mcp:dev",          desc: "MCPサーバー起動（開発: tsx でホットリロード）" },
  { cmd: "npm run test",             desc: "全テスト実行" },
  { cmd: "npm run ci",               desc: "型チェック + テスト + 依存監査（CI 相当）" },
  { cmd: "npm run scaffold",         desc: "エージェント / スキル / ペルソナの雛形を生成" },
  { cmd: "npm run clean:outputs",    desc: "outputs/ の古いファイルを削除" },
  { cmd: "npm run mask:logs",        desc: "既存ログのシークレットを再マスク" },
];

const SECONDARY = [
  { cmd: "npm run archive:history",  desc: "会話履歴を outputs/backups/ へアーカイブ" },
  { cmd: "npm run report:metrics",   desc: "メトリクスレポートを出力" },
  { cmd: "npm run lint:outputs",     desc: "outputs/ の形式を lint" },
  { cmd: "npm run docs:build",       desc: "ツール一覧ドキュメントを再生成" },
  { cmd: "npm run ai",               desc: "AI対話モード（アドホック分析等）" },
];

const pad = (s, n) => s + " ".repeat(Math.max(1, n - s.length));
const CMD_WIDTH = 30;

console.log();
console.log(`${BOLD}${CYAN}Salesforce AI Company — よく使うコマンド${RESET}`);
console.log("─".repeat(60));

console.log(`\n${BOLD}■ 日常操作${RESET}`);
for (const { cmd, desc } of COMMANDS) {
  console.log(`  ${GREEN}${pad(cmd, CMD_WIDTH)}${RESET}${desc}`);
}

console.log(`\n${BOLD}■ 管理・メンテナンス${RESET}`);
for (const { cmd, desc } of SECONDARY) {
  console.log(`  ${DIM}${pad(cmd, CMD_WIDTH)}${RESET}${desc}`);
}

console.log();
console.log(`${DIM}すべてのコマンド一覧: cat package.json | grep -A1 '"scripts"'${RESET}`);
console.log();
