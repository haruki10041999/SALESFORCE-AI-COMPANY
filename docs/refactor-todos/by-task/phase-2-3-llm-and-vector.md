# Phase 2-3: LLM / Vector TODO

## ゴール

LLM 呼び出しと vector store を自作実装から標準ライブラリへ寄せる。

## ToDo

- [ ] `@langchain/core`, `@langchain/ollama` を導入する
- [ ] `@langchain/community` を導入する
- [ ] `mcp/core/llm/langchain-llm.ts` を追加する
- [ ] `mcp/core/llm/langchain-embedding.ts` を追加する
- [ ] [mcp/handlers/register-smart-chat-tools.ts](../../mcp/handlers/register-smart-chat-tools.ts) の 1 経路だけ LangChain 化する
- [ ] [mcp/core/llm/ollama-client.ts](../../mcp/core/llm/ollama-client.ts) と新実装を env 切替で併存させる
- [ ] `db/schema/memory.ts` を追加する
- [ ] `memory/adapters/pgvector-vector-store.ts` を追加する
- [ ] [memory/vector-store.ts](../../memory/vector-store.ts) の Public API を維持したまま backend を切替可能にする
- [ ] `scripts/migrate-vector-to-pgvector.ts` を追加する
- [ ] vector store 系テストを jsonl / pgvector の両方で通す

## 完了条件

- [ ] `SF_AI_LLM_CLIENT=langchain` で chat が動く
- [ ] `SF_AI_VECTOR_BACKEND=pgvector` で検索が動く
- [ ] 既存の MCP ツール契約は変わらない
