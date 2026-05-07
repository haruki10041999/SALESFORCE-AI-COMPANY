# pg-boss

## 役割

`pg-boss` は PostgreSQL ベースのジョブキューです。提案キューや定期処理をファイルではなく DB で安全に扱うために使います。

## 想定適用箇所

- `mcp/core/resource/proposal/queue-pgboss.ts`（新規）
- [mcp/core/resource/proposal/queue.ts](../mcp/core/resource/proposal/queue.ts)
- [mcp/handlers/register-proposal-queue-tools.ts](../mcp/handlers/register-proposal-queue-tools.ts)
- [mcp/core/resource/cleanup-scheduler.ts](../mcp/core/resource/cleanup-scheduler.ts)

## 最小実装例

```ts
import PgBoss from "pg-boss";

const boss = new PgBoss(process.env.DATABASE_URL!);
await boss.start();

await boss.send("proposal.pending", {
  proposalId: "p-001",
  resourceType: "tool",
  action: "approve"
});

await boss.work("proposal.pending", async (job) => {
  const { proposalId } = job.data;
  console.log(`process proposal ${proposalId}`);
});
```

## このリポジトリでの使い方

- pending / approved / rejected のファイル移動を job status に寄せる
- `auto_apply_pending_proposals` は定期ジョブにする
- cleanup schedule も DB ベースで再実行可能にする

## 注意点

- payload は zod で検証する
- idempotent に処理できる job にする
- 監査ログは別テーブル / operations log に残す
