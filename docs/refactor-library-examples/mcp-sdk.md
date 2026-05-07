# MCP SDK

## 役割

`@modelcontextprotocol/sdk` は MCP サーバそのものを実装するための基盤です。このリポジトリでは外部クライアントに公開する API 層なので、置換対象ではなく継続利用です。

## 想定適用箇所

- [mcp/server.ts](../mcp/server.ts)
- [mcp/bootstrap.ts](../mcp/bootstrap.ts)
- [mcp/transport.ts](../mcp/transport.ts)

## 最小実装例

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "example", version: "1.0.0" });

server.tool(
  "ping",
  "疎通確認用ツール",
  { message: z.string().optional() },
  async ({ message }) => ({
    content: [{ type: "text", text: `pong: ${message ?? "ok"}` }]
  })
);

const transport = new StdioServerTransport();
await server.connect(transport);
```

## このリポジトリでの使い方

- ツール定義は `register-*.ts` に集約する
- MCP の入出力契約は維持し、内部実装だけ差し替える
- 永続化や LLM 呼び出しの差し替えは handler の外側ではなく内側で行う

## 注意点

- ここは外部契約なので破壊的変更を避ける
- zod スキーマ変更は MCP クライアント互換性に直結する
