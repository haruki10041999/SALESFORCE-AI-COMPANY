# 開発者ガイド

このガイドは、開発・改修時に必要な導線だけをまとめたものです。

## まず読む順番

1. `README.md`
2. `docs/architecture.md`
3. `docs/documentation-map.md`

## ローカル開発

```bash
npm install
npm run init
npm run build
npm run mcp:dev
```

## 品質チェック

```bash
npm run typecheck
npm test
npm run doctor
```

## 主要な実装ポイント

- ツール登録: `mcp/handlers/register-*.ts`
- ツール本体: `mcp/tools/`
- 共通ロジック: `mcp/core/`
- サーバー構成: `mcp/server.ts`

## ドキュメント更新ルール

- 機能仕様は `docs/features/` を優先して更新
- 運用説明は `operations-guide.md` を優先して更新
- 設定変更時は `configuration.md` と `.env.sample` を同時更新
- 履歴は `CHANGELOG.md` に記録

## 検証観点

- 追加ツールは最小1件のテストを追加
- 変更後は `npm run build` と関連テストを実行
- 出力保存仕様を変える場合は `outputs-structure.md` を更新
