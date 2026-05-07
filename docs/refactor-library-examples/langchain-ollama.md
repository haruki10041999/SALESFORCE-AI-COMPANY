# LangChain / Ollama / PGVectorStore

## 役割

- `@langchain/core`: LLM 抽象、message 型、Runnable
- `@langchain/ollama`: Ollama 連携
- `@langchain/community`: `PGVectorStore` などの統合

## 想定適用箇所

- `mcp/core/llm/langchain-llm.ts`（新規）
- `mcp/core/llm/langchain-embedding.ts`（新規）
- [mcp/handlers/register-smart-chat-tools.ts](../mcp/handlers/register-smart-chat-tools.ts)
- [memory/vector-store.ts](../memory/vector-store.ts)

## ChatOllama 例

```ts
import { ChatOllama } from "@langchain/ollama";

const llm = new ChatOllama({
  baseUrl: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
  model: process.env.OLLAMA_CHAT_MODEL ?? "qwen2.5:3b",
  temperature: 0
});

const response = await llm.invoke([
  { role: "system", content: "You are a precise reviewer." },
  { role: "user", content: "Summarize this diff." }
]);
```

## Embeddings 例

```ts
import { OllamaEmbeddings } from "@langchain/ollama";

const embeddings = new OllamaEmbeddings({
  baseUrl: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
  model: process.env.OLLAMA_EMBED_MODEL ?? "nomic-embed-text"
});

const vector = await embeddings.embedQuery("governance state and disabled tools");
```

## PGVectorStore 例

```ts
import { PGVectorStore } from "@langchain/community/vectorstores/pgvector";

const store = await PGVectorStore.initialize(embeddings, {
  postgresConnectionOptions: {
    connectionString: process.env.DATABASE_URL
  },
  tableName: "memory_records"
});

await store.addDocuments([
  { pageContent: "disabled tools list", metadata: { scope: "governance" } }
]);
```

## 注意点

- LangChain は導入しても handler 契約は変えない
- まずは `smart_chat` の 1 経路だけ切り替える
- callback や retry は乱立させず共通化する
