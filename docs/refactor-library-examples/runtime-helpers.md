# p-retry / p-limit / p-timeout / lru-cache / ajv / croner

## 役割

ランタイム周辺の自作ユーティリティを標準ライブラリへ寄せるためのセットです。

## 想定適用箇所

- [mcp/core/llm/ollama-client.ts](../mcp/core/llm/ollama-client.ts)
- [mcp/core/governance/disabled-tools-cache.ts](../mcp/core/governance/disabled-tools-cache.ts)
- [mcp/core/context/chat-prompt-builder.ts](../mcp/core/context/chat-prompt-builder.ts)
- [scripts/lint-outputs.ts](../scripts/lint-outputs.ts)
- [mcp/core/resource/cleanup-scheduler.ts](../mcp/core/resource/cleanup-scheduler.ts)

## p-retry / p-timeout 例

```ts
import pRetry from "p-retry";
import pTimeout from "p-timeout";

const result = await pRetry(
  () => pTimeout(fetch("http://localhost:11434/api/tags"), { milliseconds: 5000 }),
  { retries: 2 }
);
```

## p-limit 例

```ts
import pLimit from "p-limit";

const limit = pLimit(4);
const results = await Promise.all(files.map((file) => limit(() => analyzeFile(file))));
```

## lru-cache 例

```ts
import { LRUCache } from "lru-cache";

const cache = new LRUCache<string, string>({ max: 500, ttl: 60_000 });
cache.set("key", "value");
```

## ajv 例

```ts
import Ajv from "ajv";

const ajv = new Ajv({ allErrors: true });
const validate = ajv.compile(schema);
if (!validate(payload)) throw new Error(ajv.errorsText(validate.errors));
```

## croner 例

```ts
import Cron from "croner";

const job = new Cron("0 * * * *", () => {
  console.log("run hourly");
});
job.stop();
```

## 注意点

- retry と timeout は多重適用しない
- cache は最大件数と TTL を env から制御できるようにする
- cron の実行責務は pg-boss と二重にしない
