# By File: Persistence / DB

## 対象ファイル

- [mcp/core/persistence/sqlite-store.ts](../../mcp/core/persistence/sqlite-store.ts)
- [mcp/core/governance/governance-state-manager.ts](../../mcp/core/governance/governance-state-manager.ts)
- [mcp/core/context/history-store.ts](../../mcp/core/context/history-store.ts)
- [scripts/migrate-jsonl-to-sqlite.ts](../../scripts/migrate-jsonl-to-sqlite.ts)
- `db/client.ts`（新）
- `db/schema/*.ts`（新）
- `mcp/core/persistence/state-store.ts`（新）
- `mcp/core/persistence/postgres-store.ts`（新）

## ToDo

- [ ] store interface を抽出する
- [ ] governance から Postgres 化を始める
- [ ] 履歴 / state / 汎用 JSON データのテーブル方針を決める
- [ ] migration と rollback の導線を用意する
- [ ] SQLite 削除前の dual-run 手順を決める
