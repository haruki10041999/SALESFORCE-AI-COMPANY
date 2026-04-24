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

## MCP SDK 更新ランブック

このプロジェクトで `@modelcontextprotocol/sdk` を更新する場合は、次の順序で実施します。

1. 依存更新

```bash
npm outdated @modelcontextprotocol/sdk
npm install @modelcontextprotocol/sdk@latest
```

2. 型差分確認

```bash
npm run typecheck
```

3. 登録層の互換性確認

- `mcp/handlers/register-*.ts` で SDK 型エラーが出ていないことを確認
- `mcp/server.ts` のツール登録と起動フローに破壊的変更がないことを確認

4. 統合テスト

```bash
npm test
```

5. ドキュメント差分反映

- SDK 更新理由と影響を `docs/CHANGELOG.md` の `Unreleased` に追記
- 必要なら `docs/feature-usage-guide.md` と `docs/verification-guide.md` のコマンド例を更新

### 推奨チェックポイント

- 変更前後で `docs/internal/tool-manifest.json` の差分を確認し、意図しないスキーマ変化がないことを確認
- ハンドラー周辺の回帰確認として、少なくとも次を再実行
	- `node --import tsx --test tests/handlers-modules.test.ts`
	- `node --import tsx --test tests/core-tools.test.ts`

### ロールバック手順

- 更新後に互換性問題が出た場合は、直前バージョンを再インストール

```bash
npm install @modelcontextprotocol/sdk@<previous-version>
npm run typecheck
npm test
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
