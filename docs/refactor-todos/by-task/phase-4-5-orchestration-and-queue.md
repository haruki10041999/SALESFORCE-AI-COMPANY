# Phase 4-5: Orchestration / Queue TODO

## ゴール

自作 orchestration は維持しつつ永続化だけ Postgres 化し、proposal queue は pg-boss へ移行する。

## ToDo

- [ ] `db/schema/orchestration.ts` を追加する
- [ ] `mcp/core/orchestration/session-store-postgres.ts` を追加する
- [ ] [mcp/core/orchestration/session-registry.ts](../../mcp/core/orchestration/session-registry.ts) を差し替え可能にする
- [ ] [mcp/core/context/history-store.ts](../../mcp/core/context/history-store.ts) を DB 経由へ寄せる
- [ ] session 復元系テストを Postgres backend でも通す
- [ ] `pg-boss` を導入する
- [ ] `mcp/core/resource/proposal/queue-pgboss.ts` を追加する
- [ ] [mcp/handlers/register-proposal-queue-tools.ts](../../mcp/handlers/register-proposal-queue-tools.ts) を queue adapter 経由に寄せる
- [ ] [mcp/core/resource/cleanup-scheduler.ts](../../mcp/core/resource/cleanup-scheduler.ts) を pg-boss / croner と整合させる
- [ ] approved / rejected の監査ログ保存方針を決める

## 完了条件

- [ ] orchestration session が再起動後も復元できる
- [ ] proposal queue がファイルではなく DB で処理される
- [ ] 自動実行系ジョブが再実行安全になっている
