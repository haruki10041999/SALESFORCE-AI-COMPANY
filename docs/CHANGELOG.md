# Changelog

このプロジェクトの変更履歴は、このファイルに記録します。
形式は Keep a Changelog を参考にし、バージョニングは SemVer に準拠します。

## [Unreleased]

### Added (2026-04-24 Phase 2-4)

- **TASK-036** [`mcp/core/resource/query-intent-classifier.ts`](../mcp/core/resource/query-intent-classifier.ts): topic から 7 種 intent (debug / design / review / explain / fix / test / generic) を判定しスコアに override を適用。
- **TASK-037** [`mcp/core/resource/cascading-delete.ts`](../mcp/core/resource/cascading-delete.ts): `apply_resource_actions` に `cascadeMode` (force / prompt / block) を追加し依存リソースの連鎖判定を実装。
- **TASK-038** [`mcp/core/trace/trace-context.ts`](../mcp/core/trace/trace-context.ts): `startPhase` / `endPhase` / `withPhase` を追加。`chat` / `orchestrate_chat` を `input` / `plan` / `execute` / `render` の 4 phase で計測し `metrics_summary` に `phaseBreakdown` を出力。
- **TASK-039** [`mcp/core/resource/usage-pattern.ts`](../mcp/core/resource/usage-pattern.ts): daily / weekly / burst / dormant の利用パターン検出を追加し `suggest_cleanup_resources` に統合。
- **TASK-040** [`mcp/core/context/persona-style-registry.ts`](../mcp/core/context/persona-style-registry.ts): 15 persona 分の tone / sectionOrder / hints を登録しプロンプト整形に反映。
- **TASK-041** [`mcp/core/resource/cleanup-scheduler.ts`](../mcp/core/resource/cleanup-scheduler.ts): cron スタイルのスケジューラと `governance_auto_cleanup_schedule` MCP ツールを追加。
- **TASK-042** [`mcp/core/resource/embedding-ranker.ts`](../mcp/core/resource/embedding-ranker.ts): n-gram cosine による hybrid rescore (`embeddingMode` / `embeddingAlpha`) を `selectResources` に追加。
- **TASK-043** [`mcp/core/resource/synergy-model.ts`](../mcp/core/resource/synergy-model.ts) と新ツール `synergy_recommend_combo` を追加。`agent-trust-score.evaluateAgentTrust` に `synergyBonus` 引数 (最大 +0.15)、`selectResources` に synergy bonus 経路を追加。
- **TASK-044** [`mcp/core/observability/dashboard.ts`](../mcp/core/observability/dashboard.ts) と MCP ツール `observability_dashboard` を追加し `outputs/dashboards/observability.{html,md,json}` を生成。
- **TASK-045** [`mcp/core/learning/model-registry.ts`](../mcp/core/learning/model-registry.ts): shadow → promote → rollback の段階反映を実装。
- **TASK-046** [`mcp/core/context/prompt-cache-persistence.ts`](../mcp/core/context/prompt-cache-persistence.ts): 環境変数 `PROMPT_CACHE_FILE` で JSONL 永続化と TTL 復元に対応。
- **TASK-047** [`mcp/core/learning/rl-feedback.ts`](../mcp/core/learning/rl-feedback.ts): Thompson Sampling bandit (Marsaglia-Tsang Gamma) と `forcedExplorationRate` を追加。
- **TASK-031** [`mcp/tools/agent-ab-test.ts`](../mcp/tools/agent-ab-test.ts) に仕様準拠の `applyAbTestOutcome(trustStorePath, winner, loser, magnitude)` エイリアスを追加。
- **TASK-048** [`tests/property-based.test.ts`](../tests/property-based.test.ts): `fast-check` で scoring / learning / trust の不変条件 10 properties を追加。
- **TASK-049** [`docs/architecture.md`](./architecture.md): Core 層の説明を更新し Mermaid サブシステム関係図を追加。
- **TASK-050** [`.github/workflows/benchmark-nightly.yml`](../.github/workflows/benchmark-nightly.yml): 毎日 19:30 UTC に benchmark を実行し grade 低下で alert、`outputs/benchmark/` に蓄積。
- **検証ドキュメント** [`docs/full-feature-verification.md`](./full-feature-verification.md): 全機能を一通り動作確認するための網羅的検証手順を追加。

### Added

- `docs/architecture.md` を追加し、レイヤ構成・主要フロー・非機能観点を整理。
- `docs/features/` に機能別ドキュメントを追加（11カテゴリ）。
- `docs/documentation-map.md` を追加し、用途別導線を整備。
- Trace / Metrics 集約の運用導線を明確化。
- `scripts/cleanup-outputs.ts` を追加し、`outputs/history` と `outputs/sessions` の保持期間クリーンアップを自動化。
- `docs/metrics-evaluation.md` を追加し、各評価指標の算出式・しきい値・運用基準を明確化。
- `.github/workflows/metrics-dashboard-publish.yml` を追加し、GitHub Pages へダッシュボードを定期公開。
- `docs/developer-guide.md` に MCP SDK 更新ランブック（依存更新、型差分確認、互換性確認、統合テスト、ドキュメント反映）を追加。
- `mcp/tool-registry.ts` を追加し、ツール登録責務を分離。
- `mcp/transport.ts` を追加し、stdio 接続責務を明示化。
- `mcp/lifecycle.ts` を追加し、起動・終了・エラーハンドリング責務を分離。

### Changed

- `README.md` の起動手順を `npm run mcp:dev` / `npm run mcp:start` ベースに更新。
- `verification-guide.md` のテスト手順を `npm test` に統一。
- `docs/feature-usage-guide.md` のコマンド・環境変数説明を更新。
- `mcp/tools/branch-diff-summary.ts` の Git 差分取得処理を共通ヘルパ利用に統一。
- `mcp/tools/changed-tests-suggest.ts` と `mcp/tools/coverage-estimate.ts` に targetOrg の共通検証を適用。
- `docs/outputs-structure.md` に outputs の運用ルールと cleanup 手順を追記。
- `scripts/metrics-dashboard.js` に指標評価方法の表示を追加し、metrics ファイル未存在時の空ダッシュボード生成に対応。
- `mcp/server.ts` をリファクタし、登録・接続・起動責務を新規モジュールへ委譲（TASK-006 完了）。

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
