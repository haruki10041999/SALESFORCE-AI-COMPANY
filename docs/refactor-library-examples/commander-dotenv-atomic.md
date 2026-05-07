# Commander / Dotenv / write-file-atomic

## 役割

- `commander`: CLI 定義を整理する
- `dotenv`: env 読み込みを標準化する
- `write-file-atomic`: 原子的ファイル書き込みを共通化する

## 想定適用箇所

- [scripts/ai.ts](../scripts/ai.ts)
- [scripts/help.js](../scripts/help.js)
- [mcp/env-loader.ts](../mcp/env-loader.ts)
- [mcp/core/io/atomic-write.ts](../mcp/core/io/atomic-write.ts)
- [mcp/core/persistence/atomic-file.ts](../mcp/core/persistence/atomic-file.ts)

## Commander 例

```ts
import { Command } from "commander";

const program = new Command();
program.name("sfai").description("Salesforce AI Company CLI");

program.command("doctor")
  .description("check local runtime")
  .action(async () => {
    console.log("doctor");
  });

await program.parseAsync(process.argv);
```

## Dotenv 例

```ts
import dotenv from "dotenv";

dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.local", override: true });
```

## write-file-atomic 例

```ts
import writeFileAtomic from "write-file-atomic";

await writeFileAtomic("outputs/sample.json", JSON.stringify({ ok: true }, null, 2));
```

## 注意点

- env 読み込み順序は現行仕様を壊さない
- すべての CLI を一度に作り直さず、`ai.ts` を正本に寄せる
- DB 移行後もファイル生成物は atomic write を維持する
