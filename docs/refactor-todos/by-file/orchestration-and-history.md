# By File: Orchestration / History

## 対象ファイル

- [mcp/core/orchestration/dag-engine.ts](../../mcp/core/orchestration/dag-engine.ts)
- [mcp/core/orchestration/chat-tool-runner.ts](../../mcp/core/orchestration/chat-tool-runner.ts)
- [mcp/core/orchestration/pseudo-hooks.ts](../../mcp/core/orchestration/pseudo-hooks.ts)
- [mcp/core/orchestration/session-registry.ts](../../mcp/core/orchestration/session-registry.ts)
- [mcp/core/context/orchestration-session-store.ts](../../mcp/core/context/orchestration-session-store.ts)
- [mcp/handlers/register-history-tools.ts](../../mcp/handlers/register-history-tools.ts)
- [mcp/handlers/register-chat-orchestration-tools.ts](../../mcp/handlers/register-chat-orchestration-tools.ts)

## ToDo

- [ ] orchestration 自体は維持し、永続化だけを抽象化する
- [ ] session / message テーブル設計を決める
- [ ] restore / save 系ツールのレスポンス互換を守る
- [ ] history 保存と orchestration 保存の責務を整理する
