# 検証ガイド（技術向け）

このページは、開発変更の検証手順をまとめた技術向けドキュメントです。
日常運用のチェックは `operations-guide.md` を参照してください。

## 標準検証フロー

1. ビルド

```bash
npm run build
```

2. 型チェック

```bash
npm run typecheck
```

3. テスト

```bash
npm test
```

4. 健全性チェック

```bash
npm run doctor
```

## 変更タイプ別の追加検証

### 解析ツールを追加・変更した場合

- 対象テストを個別実行

```bash
node --test --import tsx tests/apex-dependency-graph.test.ts
node --test --import tsx tests/permission-set-diff.test.ts
```

### 学習・推薦ロジックを変更した場合

```bash
node --test --import tsx tests/proposal-feedback.test.ts
```

### 登録系（handler/server catalog）を変更した場合

- `npm run build` 成功
- 追加ツール名が `mcp/server.ts` のカタログに存在
- 対応する `docs/features` の更新がある

## リリース前チェック

- `npm run build` 成功
- `npm test` で fail 0
- `CHANGELOG.md` 更新済み
- 必要なドキュメント更新済み（設定・運用・機能仕様）

## 関連ドキュメント

- `operations-guide.md`
- `developer-guide.md`
- `documentation-map.md`
