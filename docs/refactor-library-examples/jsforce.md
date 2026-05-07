# jsforce

## 役割

`jsforce` は Salesforce Org に対して API 経由で接続するためのクライアントです。現時点では将来検討扱いで、SFDX wrapper では足りない直接連携が必要になった時に採用します。

## 想定適用箇所

- `mcp/core/org/jsforce-client.ts`（新規）
- [mcp/core/org/org-catalog-store.ts](../mcp/core/org/org-catalog-store.ts)
- [mcp/handlers/register-org-catalog-tools.ts](../mcp/handlers/register-org-catalog-tools.ts)
- [mcp/tools/deploy-org.ts](../mcp/tools/deploy-org.ts)
- [mcp/tools/run-deployment-verification.ts](../mcp/tools/run-deployment-verification.ts)
- [mcp/tools/run-tests.ts](../mcp/tools/run-tests.ts)
- [scripts/sfdx-wrapper.js](../scripts/sfdx-wrapper.js)

## 最小実装例

```ts
import jsforce from "jsforce";

const conn = new jsforce.Connection({ loginUrl: process.env.SF_LOGIN_URL });
await conn.login(process.env.SF_USERNAME!, process.env.SF_PASSWORD!);

const result = await conn.query("SELECT Id, Name FROM Account LIMIT 5");
console.log(result.records);
```

## このリポジトリでの使い方

- まずは org catalog の read 系から試す
- deploy / test 実行は既存 CLI ラッパと併用し、段階的に責務を分離する
- 接続情報は env と secret に限定する

## 注意点

- Salesforce 側の利用環境は無料前提ではない
- 認証方式は username/password に固定せず OAuth / JWT も視野に入れる
