# Handwritten Docs Policy

このディレクトリは、人が直接編集するドキュメントの将来配置先です。

## Source-of-Truth ルール

- `docs/generated/**`: 生成物。手編集しない。
- `docs/handwritten/**`: 手書きドキュメント。レビュー後に更新する。

## 段階移行ポリシー

当面は既存の `docs/*.md` を互換維持のため残し、以下の順で移行します。

1. 新規の手書きドキュメントは `docs/handwritten/` に作成する。
2. 既存の手書きドキュメントを更新する際に、必要に応じて `docs/handwritten/` へ移動する。
3. 旧パスは 1 リリース以上の互換期間を置いてから整理する。

## 禁止事項

- `docs/generated/**` の手編集
- 生成ファイルに対するレビューコメントでの直接修正要求

## 推奨フロー

1. 生成物更新: `npm run docs:build` または専用生成コマンドを実行
2. 手書き更新: `docs/handwritten/**` または既存の手書きドキュメントを編集
3. 検証: `npm run lint:docs`
