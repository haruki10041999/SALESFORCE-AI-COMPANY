# Pino

## 役割

`pino` は Node 向けの高速な構造化ロガーです。現在の自作 logger を薄いラッパへ整理し、ログ形式を標準化するために使います。

## 想定適用箇所

- [mcp/core/logging/logger.ts](../mcp/core/logging/logger.ts)
- [mcp/server.ts](../mcp/server.ts)
- 各 handler / core module の logger 呼び出し

## 最小実装例

```ts
import pino from "pino";

const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "salesforce-ai-company" }
});

logger.info({ tool: "smart_chat" }, "tool start");
logger.error({ err: new Error("failed") }, "tool failed");
```

## このリポジトリでの使い方

- 既存の `createLogger()` を残し、中で pino を返す
- 既存 import を壊さない移行にする
- traceId, toolName, sessionId をログの共通 field にする

## 注意点

- 開発時だけ `pino-pretty` を噛ませる
- 本番は JSON 出力を維持する
