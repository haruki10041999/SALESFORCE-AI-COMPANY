# By File: LLM / Vector

## 対象ファイル

- [mcp/core/llm/ollama-client.ts](../../mcp/core/llm/ollama-client.ts)
- [mcp/core/llm/embedding-provider.ts](../../mcp/core/llm/embedding-provider.ts)
- [mcp/core/llm/quality-rubric.ts](../../mcp/core/llm/quality-rubric.ts)
- [mcp/handlers/register-smart-chat-tools.ts](../../mcp/handlers/register-smart-chat-tools.ts)
- [memory/vector-store.ts](../../memory/vector-store.ts)
- [memory/vector-store-adapter.ts](../../memory/vector-store-adapter.ts)
- [memory/adapters/jsonl-vector-store.ts](../../memory/adapters/jsonl-vector-store.ts)
- [memory/project-memory.ts](../../memory/project-memory.ts)
- [memory/failure-memory.ts](../../memory/failure-memory.ts)

## ToDo

- [ ] LangChain ラッパーを追加する
- [ ] 既存 Ollama 実装との切替フラグを入れる
- [ ] PGVectorStore adapter を追加する
- [ ] memory API を壊さず backend を差し替える
- [ ] jsonl vector store の削除条件を決める
