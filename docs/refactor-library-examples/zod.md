# Zod

## 役割

`zod` は入力値、設定値、frontmatter、内部データの実行時検証に使います。TypeScript の型だけでは防げない不正入力を境界で止めるための土台です。

## 想定適用箇所

- MCP ツール入力スキーマ
- frontmatter スキーマ
- env / config スキーマ
- DB から復元した JSON の検証

## 最小実装例

```ts
import { z } from "zod";

export const GovernanceStateSchema = z.object({
  updatedAt: z.string(),
  disabledTools: z.array(z.string()).default([]),
  mode: z.enum(["normal", "restricted"]).default("normal")
});

export type GovernanceState = z.infer<typeof GovernanceStateSchema>;

export function parseGovernanceState(input: unknown): GovernanceState {
  return GovernanceStateSchema.parse(input);
}
```

## このリポジトリでの使い方

- handler 入力は zod を単一の正本にする
- `drizzle` の JSON 列から復元した値も zod で再検証する
- `gray-matter` 導入後も frontmatter の最終保証は zod に残す

## 注意点

- parse 例外をそのまま投げず、必要に応じて `AppError` に変換する
- schema は handler 層と domain 層で二重管理しない
