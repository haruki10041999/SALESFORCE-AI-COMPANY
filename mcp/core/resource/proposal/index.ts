/**
 * Proposal サブシステムのバレル再エクスポート。
 *
 * 旧 `mcp/core/resource/proposal-{queue,applier}.ts` および
 * `auto-create-gate.ts` をこのディレクトリへ集約した。外部からは本ファイル
 * 経由でインポートするか、各サブモジュール (`./queue`, `./applier`,
 * `./auto-create-gate`) を直接参照できる。
 */
export * from "./queue.js";
export * from "./applier.js";
export * from "./auto-create-gate.js";
