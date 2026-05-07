# PostgreSQL / Drizzle / pgvector / Testcontainers

## 役割

- `pg`: PostgreSQL 接続
- `drizzle-orm`: 型安全な DB 操作
- `drizzle-kit`: マイグレーション生成と適用
- `pgvector`: embedding 保存と類似検索
- `@testcontainers/postgresql`: Docker ベース統合テスト

## 想定適用箇所

- `db/schema/*.ts`（新規）
- `db/client.ts`（新規）
- `mcp/core/persistence/postgres-store.ts`（新規）
- [mcp/core/governance/governance-state-manager.ts](../mcp/core/governance/governance-state-manager.ts)
- [mcp/core/context/history-store.ts](../mcp/core/context/history-store.ts)

## 最小実装例

```ts
import { drizzle } from "drizzle-orm/node-postgres";
import { pgTable, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { Pool } from "pg";

export const governanceState = pgTable("governance_state", {
  id: text("id").primaryKey(),
  stateJson: jsonb("state_json").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull()
});

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool);

export async function saveGovernanceState(state: unknown) {
  await db.insert(governanceState).values({
    id: "singleton",
    stateJson: state,
    updatedAt: new Date()
  }).onConflictDoUpdate({
    target: governanceState.id,
    set: { stateJson: state, updatedAt: new Date() }
  });
}
```

## pgvector 例

```ts
import { pgTable, text, vector } from "drizzle-orm/pg-core";

export const memoryRecords = pgTable("memory_records", {
  id: text("id").primaryKey(),
  content: text("content").notNull(),
  embedding: vector("embedding", { dimensions: 768 }).notNull()
});
```

## Testcontainers 例

```ts
import { PostgreSqlContainer } from "@testcontainers/postgresql";

const container = await new PostgreSqlContainer("pgvector/pgvector:pg17").start();
process.env.DATABASE_URL = container.getConnectionUri();
```

## 注意点

- `drizzle` は薄く使い、domain ロジックを ORM に寄せ過ぎない
- `jsonb` 列は zod で再検証する
- pgvector の index 種別は初期は単純に始め、後でチューニングする
