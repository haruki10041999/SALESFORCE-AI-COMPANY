# i18next / ora / cli-progress / cli-table3 / chalk / diff

## 役割

- `i18next`: 文言管理
- `ora`: spinner
- `cli-progress`: progress bar
- `cli-table3`: 表表示
- `chalk`: 色付け
- `diff`: 差分表現

## 想定適用箇所

- [mcp/core/errors/messages.ts](../mcp/core/errors/messages.ts)
- [mcp/core/i18n/locale.ts](../mcp/core/i18n/locale.ts)
- [scripts/help.js](../scripts/help.js)
- [scripts/doctor.js](../scripts/doctor.js)
- [scripts/metrics-dashboard.js](../scripts/metrics-dashboard.js)
- [mcp/core/dependency/signature-diff.ts](../mcp/core/dependency/signature-diff.ts)

## i18next 例

```ts
import i18next from "i18next";

await i18next.init({
  lng: "ja",
  resources: {
    ja: { translation: { INVALID_PATH: "パスが不正です" } },
    en: { translation: { INVALID_PATH: "Invalid path" } }
  }
});

const message = i18next.t("INVALID_PATH");
```

## CLI 表示例

```ts
import ora from "ora";
import chalk from "chalk";
import Table from "cli-table3";

const spinner = ora("checking docker runtime").start();
spinner.succeed("runtime ok");

const table = new Table({ head: ["service", "status"] });
table.push(["postgres", chalk.green("ok")]);
console.log(table.toString());
```

## diff 例

```ts
import { diffLines } from "diff";

const changes = diffLines(oldText, newText);
for (const part of changes) {
  if (part.added) console.log(`+ ${part.value}`);
  else if (part.removed) console.log(`- ${part.value}`);
}
```

## 注意点

- CLI 装飾は非対話環境では抑制する
- i18next は error code を key にして移行する
- diff は表示専用に使い、判定ロジックとは分離する
