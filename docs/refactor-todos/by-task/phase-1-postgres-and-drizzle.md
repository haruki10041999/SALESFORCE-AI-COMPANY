# Phase 1: PostgreSQL / Drizzle TODO

## ゴール

SQLite / JSONL 依存から脱却するための DB 基盤を導入し、最小 1 機能を Postgres へ切り替える。

## ToDo

- [ ] `pg`, `drizzle-orm`, `pgvector` を導入する
- [ ] `drizzle-kit`, `@types/pg`, `@testcontainers/postgresql` を導入する
- [ ] `db/client.ts` を追加する
- [ ] `drizzle.config.ts` を追加する
- [ ] `db/schema/governance.ts` を追加する
- [ ] `db/schema/index.ts` を追加する
- [ ] `mcp/core/persistence/state-store.ts` を追加する
- [ ] `mcp/core/persistence/postgres-store.ts` を追加する
- [ ] [mcp/core/governance/governance-state-manager.ts](../../mcp/core/governance/governance-state-manager.ts) を `StateStore` 経由に寄せる
- [ ] [mcp/core/persistence/sqlite-store.ts](../../mcp/core/persistence/sqlite-store.ts) を実装の 1 つとして残す
- [ ] `package.json` に `db:generate`, `db:migrate`, `db:push` を追加する
- [ ] Postgres ベースの統合テストを 1 本追加する

## 完了条件

- [ ] `governance_state` が Postgres へ保存できる
- [ ] `SF_AI_STATE_BACKEND=postgres` で対象機能が動く
- [ ] CI で Postgres サービス付きテストが通る
