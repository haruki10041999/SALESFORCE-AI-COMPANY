# Changelog

このプロジェクトの変更履歴は、このファイルに記録します。
形式は Keep a Changelog を参考にし、バージョニングは SemVer に準拠します。

## [Unreleased]

### Added

- `docs/architecture.md` を追加し、レイヤ構成・主要フロー・非機能観点を整理。
- `docs/features/` に機能別ドキュメントを追加（11カテゴリ）。
- `docs/documentation-map.md` を追加し、用途別導線を整備。
- Trace / Metrics 集約の運用導線を明確化。
- `scripts/cleanup-outputs.ts` を追加し、`outputs/history` と `outputs/sessions` の保持期間クリーンアップを自動化。
- `docs/metrics-evaluation.md` を追加し、各評価指標の算出式・しきい値・運用基準を明確化。
- `.github/workflows/metrics-dashboard-publish.yml` を追加し、GitHub Pages へダッシュボードを定期公開。

### Changed

- `README.md` の起動手順を `npm run mcp:dev` / `npm run mcp:start` ベースに更新。
- `verification-guide.md` のテスト手順を `npm test` に統一。
- `docs/feature-usage-guide.md` のコマンド・環境変数説明を更新。
- `mcp/tools/branch-diff-summary.ts` の Git 差分取得処理を共通ヘルパ利用に統一。
- `mcp/tools/changed-tests-suggest.ts` と `mcp/tools/coverage-estimate.ts` に targetOrg の共通検証を適用。
- `docs/outputs-structure.md` に outputs の運用ルールと cleanup 手順を追記。
- `scripts/metrics-dashboard.js` に指標評価方法の表示を追加し、metrics ファイル未存在時の空ダッシュボード生成に対応。

### Fixed

- targetOrg の不正入力に対する防御（入力検証）を強化。
- Vector Store の LRU 振る舞いに関する回帰を防ぐテストを追加。
- テストケースを拡充し、141件の pass 状態を維持。

## [1.0.0] - 2026-04-20

### Added

- MCP サーバの初期実装。
- エージェント / スキル / ペルソナ / コンテキストの読み込み基盤。
- リソースガバナンス、イベント自動化、履歴保存の基盤。
- Salesforce 向けの主要分析ツール群。
