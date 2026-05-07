# By File: Proposal / Scheduler

## 対象ファイル

- [mcp/core/resource/proposal/queue.ts](../../mcp/core/resource/proposal/queue.ts)
- [mcp/core/resource/proposal/applier.ts](../../mcp/core/resource/proposal/applier.ts)
- [mcp/handlers/register-proposal-queue-tools.ts](../../mcp/handlers/register-proposal-queue-tools.ts)
- [mcp/core/resource/cleanup-scheduler.ts](../../mcp/core/resource/cleanup-scheduler.ts)
- [mcp/core/governance/governance-event-automation.ts](../../mcp/core/governance/governance-event-automation.ts)

## ToDo

- [ ] pg-boss queue adapter を追加する
- [ ] enqueue / approve / reject の状態遷移を DB ベースにする
- [ ] cleanup schedule の cron 判定と job 実行責務を分ける
- [ ] 監査ログの保存形式を決める
