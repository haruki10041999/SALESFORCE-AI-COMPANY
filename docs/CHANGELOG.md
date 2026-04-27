# Changelog

このプロジェクトの変更履歴は、このファイルに記録します。
形式は Keep a Changelog を参考にし、バージョニングは SemVer に準拠します。

## [Unreleased]

### Added (2026-04-27 Phase 3 — F1〜F12 / A1〜A19)

エラー応答整備・ドキュメント自動化・拡張ツール群を一括投入。MCP ツールは 89 → 105 件に増加。

#### F1〜F12 基盤・品質改善

- **F1** [`mcp/core/errors/messages.ts`](../mcp/core/errors/messages.ts): 多言語化対応の AppError / errorCode テーブルを導入し、ハンドラ層から共通利用。
- **F2** [`mcp/core/i18n/`](../mcp/core/i18n/): ロケール辞書 (`ja` / `en`) と `t()` フォーマッタを追加。エラーメッセージとレポート見出しを多言語化。
- **F3** [`mcp/core/context/context-budget.ts`](../mcp/core/context/context-budget.ts): プロンプト断片を tokens / priority で打ち切る `applyContextBudget` を実装し、`chat-prompt-builder` から使用。
- **F4** [`mcp/core/context/prompt-rendering.ts`](../mcp/core/context/prompt-rendering.ts): セクション順序・冗長性制御を持つレンダラを切り出し、persona-style と統合。
- **F5** [`mcp/core/governance/defaults.ts`](../mcp/core/governance/defaults.ts): governance 既定値を一元化し `governance-manager` が参照。
- **F6** [`mcp/core/learning/model-arbitration.ts`](../mcp/core/learning/model-arbitration.ts): shadow / candidate / production の比較とアービトレーションを追加し `model-registry` から呼び出し。
- **F7** [`mcp/core/layer-manifest.ts`](../mcp/core/layer-manifest.ts) + [`scripts/lint-core-layers.ts`](../scripts/lint-core-layers.ts): レイヤ依存制約を宣言し循環参照を検出する Lint。
- **F8** [`scripts/lint-outputs.ts`](../scripts/lint-outputs.ts): outputs 配下スキーマ整合性チェック。
- **F9** [`scripts/extract-tool-names.ts`](../scripts/extract-tool-names.ts): MCP ツール名一覧抽出ユーティリティ。
- **F10** [`scripts/generate-tools-doc.ts`](../scripts/generate-tools-doc.ts): `npm run docs:tools` で [`docs/features/tools-reference.md`](./features/tools-reference.md) を自動生成。
- **F11** [`scripts/generate-config-doc.ts`](../scripts/generate-config-doc.ts): `npm run docs:config` で [`docs/configuration.md`](./configuration.md) の governance 既定セクションを再生成。
- **F12** [`scripts/test.mjs`](../scripts/test.mjs): `pathToFileURL` を使った Windows 安定版 node:test ランナー。

#### A 系 拡張ツール (A11/A12/A13/A17 は外部ツール連携のため除外)

- **A1** [`mcp/core/org/org-catalog.ts`](../mcp/core/org/org-catalog.ts) + [`mcp/handlers/register-org-catalog-tools.ts`](../mcp/handlers/register-org-catalog-tools.ts): Org カタログ (CRUD + サマリ) と 4 つの MCP ツール (`register_org` / `remove_org` / `get_org` / `list_orgs`)。
- **A2** [`mcp/tools/apex-dependency-graph.ts`](../mcp/tools/apex-dependency-graph.ts) 強化と [`mcp/tools/apex-dependency-graph-incremental.ts`](../mcp/tools/apex-dependency-graph-incremental.ts): 差分更新対応。
- **A3** [`mcp/core/governance/governance-ui.ts`](../mcp/core/governance/governance-ui.ts): governance ルールの HTML / Markdown UI レンダラ (XSS 対策済み)。MCP ツール `render_governance_ui`。
- **A4** [`mcp/tools/recommend-skills-for-role.ts`](../mcp/tools/recommend-skills-for-role.ts): role / topic / 最近触ったファイル拡張子から関連スキルを推薦。
- **A5** [`mcp/tools/tune-prompt-templates.ts`](../mcp/tools/tune-prompt-templates.ts): avgScore / successRate / tokenEfficiency の合成スコアで promote / retire / leader を判定。
- **A6** [`mcp/tools/agent-synergy-score.ts`](../mcp/tools/agent-synergy-score.ts): 共起 lift × log(1+co) によるエージェント協調スコア。MCP ツール `score_agent_synergy`。
- **A7** [`mcp/tools/refactor-suggest.ts`](../mcp/tools/refactor-suggest.ts): リファクタ候補抽出。
- **A8** [`mcp/tools/test-scaffold-extractor.ts`](../mcp/tools/test-scaffold-extractor.ts): Apex テスト雛形抽出。
- **A9** [`mcp/tools/security-rule-scan.ts`](../mcp/tools/security-rule-scan.ts) + [`scan_security_rules`](../mcp/handlers/register-branch-review-tools.ts) MCP ツール: 10 ルール (SOQL injection / hardcoded credential / innerHTML / eval / weak crypto 等) のヒューリスティック走査。
- **A10** [`mcp/tools/apex-perf-predict.ts`](../mcp/tools/apex-perf-predict.ts) + [`predict_apex_performance`](../mcp/handlers/register-core-analysis-tools.ts) MCP ツール: SOQL/DML in loop、深いネスト、長大メソッド等のリスクスコアリング。
- **A14** [`mcp/tools/apex-changelog.ts`](../mcp/tools/apex-changelog.ts): Apex 変更履歴生成。
- **A15** [`mcp/core/observability/dashboard-drill-down.ts`](../mcp/core/observability/dashboard-drill-down.ts): toolName / status / 期間でフィルタしたドリルダウン集計と 5 秒窓相関。MCP ツール `drill_down_dashboard`。
- **A16** [`mcp/core/resource/feedback-loop-visualization.ts`](../mcp/core/resource/feedback-loop-visualization.ts): rejectReason 分布、デイリー timeline、(topic×resource) ヒートマップ、上昇/下降トレンド比較。MCP ツール `visualize_feedback_loop`。
- **A18** governance / observability dashboard 出力に統計補強。
- **A19** [`mcp/core/governance/handler-schedule.ts`](../mcp/core/governance/handler-schedule.ts): allow/deny ルールと wrap-around 時間帯 (深夜跨ぎ) を扱う `evaluateHandlerSchedule`。

#### Tests

- 上記すべての pure function に対し `tests/*.test.ts` を追加 (合計 +20 テストファイル)。`scripts/test.mjs` 経由で全 green。

#### Docs auto-regen

- [`docs/features/tools-reference.md`](./features/tools-reference.md): 105 ツールに更新 (旧 89)。
- [`docs/internal/tool-manifest.md`](./internal/tool-manifest.md) / [`docs/internal/tool-manifest.json`](./internal/tool-manifest.json): 再生成。
- [`docs/configuration.md`](./configuration.md): governance 既定セクション再生成。
- [`README.md`](../README.md): ツール総数 (60+ → 105+) を更新。

### Fixed (2026-04-27)

- [`mcp/core/quality/scan-exclusions.ts`](../mcp/core/quality/scan-exclusions.ts) を新設し、リポジトリ走査で `.sf` / `.sfdx` / `.git` / `node_modules` / `dist` / `build` / `coverage` / `.next` / `.cache` / `.vscode` / `.idea` / `.turbo` / `__pycache__` / `.venv` を除外。Salesforce CLI の自動生成キャッシュが解析対象に混入する問題を解消。
- [`mcp/tools/repo-analyzer.ts`](../mcp/tools/repo-analyzer.ts) / [`mcp/tools/apex-dependency-graph.ts`](../mcp/tools/apex-dependency-graph.ts) / [`mcp/tools/apex-dependency-graph-incremental.ts`](../mcp/tools/apex-dependency-graph-incremental.ts) で共通除外ヘルパ `shouldSkipScanDir` を適用。
- [`tests/governed-tool-registrar.test.ts`](../tests/governed-tool-registrar.test.ts): 必須となった `outputsDir` / `serverRoot` を `mkdtempSync` で生成して渡し、ビルドエラーを解消。
- [`outputs/.schema.json`](../outputs/.schema.json): A1 Org カタログ実装が書き込む実パス (`outputs/orgs/`) と allow-list の不整合 (`org-catalog`) を修正し、`orgs` に統一。あわせて [`docs/outputs-structure.md`](./outputs-structure.md) に `.schema.json` / `npm run lint:outputs` の運用節を追加。

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
