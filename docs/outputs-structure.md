# outputs フォルダ運用ガイド

このページは、`outputs` フォルダの意味を非エンジニア向けにまとめた運用説明です。

## まず理解したいこと

- `outputs` は「実行結果の保管庫」です
- アプリ本体のコードではなく、履歴・ログ・バックアップが入ります
- 困ったときの調査材料は、ほぼこのフォルダにあります

## フォルダ構成（かんたん版）

| 場所 | 何が入るか | いつ見るか |
|---|---|---|
| `outputs/history/` | チャット履歴 | 過去の会話を見返したいとき |
| `outputs/sessions/` | オーケストレーションの状態 | 実行中セッションを追いたいとき |
| `outputs/events/` | システムイベントとメトリクス | エラーや遅延を調べるとき |
| `outputs/backups/` | 世代バックアップ | 復元したいとき |
| `outputs/audit/` | 操作の監査ログ | 誰が何をしたか確認するとき |
| `outputs/tool-proposals/` | 提案学習ログ | 推薦精度の分析をするとき |
| `outputs/tool-proposals/pending/` | リソース作成提案 (保留中) | `list_proposals` / `approve_proposal` / `apply_proposal` / `auto_apply_pending_proposals` の対象 |
| `outputs/tool-proposals/approved/` | リソース作成提案 (承認済 audit) | 承認履歴の追跡 |
| `outputs/tool-proposals/rejected/` | リソース作成提案 (却下 audit) | 却下理由つき履歴 |
| `outputs/benchmark/` | nightly benchmark の結果 (TASK-050) | grade 推移や regress を確認するとき |
| `outputs/dashboards/` | observability ダッシュボード (TASK-044) | 横断的な健全性を可視化したいとき |
| `outputs/reports/` | 各種スクリプトのレポート出力 | benchmark 単発実行や coverage gap などを確認したいとき |
| `outputs/orgs/` | Salesforce Org カタログ (`catalog.json`) | `register_org` / `list_orgs` で参照 |
| `outputs/.schema.json` | outputs 直下の allow-list (TASK-F12) | 新しい永続化先を追加した時に更新 |

### `outputs/history/` の日別運用

- チャット履歴は `outputs/history/YYYY-MM-DD/<historyId>.json` に保存されます。
- 日次アーカイブは `npm run history:archive -- --date=YYYY-MM-DD` で実行します。
- アーカイブ実行後は次が生成されます。
	- `outputs/history/archive/YYYY-MM-DD.json`
	- `outputs/history/archive/YYYY-MM-DD-summary.md`

## 削除してよいもの・だめなもの

### 基本ルール

- 手動削除より、まず `npm run outputs:cleanup -- --dry-run` を使う
- 復元に使う可能性があるため、`outputs/backups/` は消さない
- `outputs:cleanup` は `history/`, `sessions/`, `reports/`, `dashboards/`, `benchmark/`, `debug/` を再帰的に整理する
- `outputs/events/` は現行の `system-events.jsonl`, `trace-log.jsonl`, `metrics-samples.jsonl` を残し、古い rotate 済みログだけを整理する

### 消してよい例

- 古い `history/` と `sessions/`（配下のサブディレクトリ含む）
- 古い `reports/`, `dashboards/`, `benchmark/`, `debug/` の生成物
- 古い `events/system-events.<stamp>.<nonce>.jsonl` などの rotate 済みログ
- 一時検証で作った不要 JSON

### 消さないほうがよい例

- `events/system-events.jsonl`
- `events/trace-log.jsonl`
- `events/metrics-samples.jsonl`
- `resource-governance.json`
- `backups/` 配下

## よく使う運用コマンド

```bash
# 構成を作り直す
npm run init

# 健全性をチェック
npm run doctor

# 古い履歴を整理（まずは確認だけ）
npm run outputs:cleanup -- --dry-run

# バックアップ作成
npm run outputs:version -- backup

# バックアップ一覧
npm run outputs:version -- list

# backups を残して outputs を空にする
npm run outputs:version -- wipe --keep-backups

# 復元
npm run outputs:version -- restore --snapshot <snapshot-id>
```

## 障害時の最短手順

1. `npm run doctor` を実行
2. `outputs/events/system-events.jsonl` を確認
3. 必要なら `outputs:version` で直近バックアップへ復元
4. 復元後に再度 `npm run doctor`

## 参考（詳細構成）

- `outputs/memory.jsonl`: プロジェクトメモリ
- `outputs/vector-store.jsonl`: ベクターストア
- `outputs/resource-governance.json`: ガバナンス設定
- `outputs/operations-log.jsonl`: 操作ログ
- `outputs/execution-origins.jsonl`: どのリポジトリ起点の実行だったかの provenance ログ

## 各ファイル / ディレクトリの更新タイミング

「いつ書き換わるか」をツール / コマンド単位で整理した一覧です。
障害調査や差分確認時に、どこを見れば変化が見えるかの目安になります。

## 自動で保存されるもの / されないもの

ここでは「通常のツール実行の中で自動的に残るもの」と、「明示的にそのツールやコマンドを呼んだ時だけ作られるもの」を分けて見られるようにしています。

### 自動で保存されるもの

通常のツール実行やチャット実行に伴って、自動で更新されるものです。

| パス | 自動保存の条件 | 備考 |
|------|----------------|------|
| `outputs/execution-origins.jsonl` | 各ツール実行の成功/失敗ごと | どのリポジトリ起点の実行かを追跡 |
| `outputs/events/system-events.jsonl` | `emitSystemEvent` が発火した時 | chat / orchestrate / governance / cleanup など |
| `outputs/events/system-events.<stamp>.<nonce>.jsonl` | イベントログ rotate 時 | 自動ローテーション |
| `outputs/events/trace-log.jsonl` | 各ツール終端で trace flush | chat / orchestrate / 各種ツール終端 |
| `outputs/events/metrics-samples.jsonl` | 各ツール終了時 | メトリクス sample を flush |
| `outputs/history/YYYY-MM-DD/<id>.json` | `record_agent_message` / `parse_and_record_chat` 実行時 | 履歴記録系ツールの実行で自動保存 |
| `outputs/sessions/<sessionId>.json` | `orchestrate_chat` 開始時や session 更新時 | evaluate / dequeue でも更新 |
| `outputs/resource-governance.json` | governance state が変わった時 | apply_resource_actions 等 |
| `outputs/operations-log.jsonl` | governance 変更操作時 | 監査寄りの操作ログ |
| `outputs/audit/*.jsonl` | `apply_resource_actions` 実行時 | リソース変更の監査ログ |
| `outputs/custom-tools/*.json` | custom tool 作成時 | `apply_resource_actions` または `apply_proposal` / `auto_apply_pending_proposals` で生成。起動時に Declarative tool loader が動的登録する (`mcp/core/declarative/loader.ts`) |

条件付きで自動保存されるもの:

| パス | 条件 | 備考 |
|------|------|------|
| `outputs/memory.jsonl` | `SF_AI_AUTO_MEMORY=1` のとき全ツール実行ごと | それ以外では `add_memory` / `clear_memory` のみ |
| `outputs/vector-store.jsonl` | `SF_AI_AUTO_MEMORY=1` のとき全ツール実行ごと | それ以外では `add_vector_record` / `query_vector_store` のみ |
| `outputs/prompt-cache.jsonl` | `PROMPT_CACHE_FILE` を設定した時 | 既定では保存されない |
| `outputs/benchmark/<stamp>.json`, `latest.json` | nightly CI 実行時 | 手元の通常運用では自動では増えない |

### 自動では保存されないもの

明示的にそのツールやコマンドを呼んだ時だけ生成・更新されるものです。

| パス | 生成される時 | 備考 |
|------|--------------|------|
| `outputs/backups/<snapshot>/...` | `npm run outputs:version -- backup` / `wipe` 前の事前 snapshot / restore 前の事前 snapshot | 手動コマンド中心 |
| `outputs/history/archive/YYYY-MM-DD.json` | `npm run history:archive` / `archive_history` | 日次アーカイブ |
| `outputs/history/archive/YYYY-MM-DD-summary.md` | `npm run history:archive` / `archive_history` | 日次サマリ |
| `outputs/dashboards/observability.{html,md,json}` | `observability_dashboard` 実行時 | 可観測性ダッシュボード |
| `outputs/reports/benchmark-suite.json` | `npm run benchmark:run` / `benchmark_suite` | 単発ベンチ |
| `outputs/reports/agent-ab-test/runs.jsonl`, `latest.{json,md}` | `agent_ab_test` 実行時 | A/B 比較レポート |
| `outputs/reports/test-coverage-gap/*.{json,md}` | `analyze_test_coverage_gap` 実行時 | 手動解析結果 |
| `outputs/reports/recommend-permission-sets/*.{json,md}` | `recommend_permission_sets` 実行時 | 手動解析結果 |
| `outputs/reports/resource-dependency-graph/*.{json,mmd}` | `resource_dependency_graph` 実行時 | 手動解析結果 |
| `outputs/reports/run-deployment-verification/*.{json,md}` | `run_deployment_verification` 実行時 | 手動解析結果 |
| `outputs/reports/suggest-flow-test-cases/*.{json,md}` | `suggest_flow_test_cases` 実行時 | 手動解析結果 |
| `outputs/reports/cleanup/*.{json,md}` | `suggest_cleanup_resources` 実行時 | cleanup 提案レポート |
| `outputs/reports/skill-auto-classify.json` | `npm run skills:classify` 実行時 | skill カテゴリ妥当性 + 類似 skill 提案 (T-ADD-07) |
| `outputs/reports/skill-rating.jsonl`, `skill-rating.json`, `skill-rating.md` | `record_skill_rating` / `get_skill_rating_report` 実行時 | 学習系だが手動トリガー |
| `outputs/tool-proposals/proposal-feedback.jsonl`, `proposal-feedback-model.json` | `proposal_feedback_learn` 実行時 | 学習系だが手動トリガー |
| `outputs/tool-proposals/query-skill-feedback.jsonl`, `query-skill-model.json` | `proposal_feedback_learn` 実行時 | skill feedback から派生して更新 |
| `outputs/agent-trust-histories.json` | `agent_ab_test` の trust 反映時 | `applyOutcomeToTrustStore=true` など |
| `outputs/skill-rating-report.md` | `auto_select_resources` / 関連リソース検索時 | レポート再生成型 |
| `outputs/cleanup-schedule.json` | `governance_auto_cleanup_schedule` 実行時 | スケジュール定義 |
| `outputs/orgs/catalog.json` | `register_org` / `remove_org` 実行時 | Org カタログ (CRUD) の永続化先 |

| パス | 形式 | 更新タイミング | 主な書き込み元 |
|------|------|----------------|----------------|
| `outputs/memory.jsonl` | JSONL (追記) | `add_memory` / `clear_memory` 実行時。または `SF_AI_AUTO_MEMORY=1` 設定時は全ツール実行成功/失敗ごとに input/output サマリを自動追記 | `memory/project-memory.ts`, `mcp/core/governance/governed-tool-registrar.ts` |
| `outputs/vector-store.jsonl` | JSONL (追記/再書き) | `add_vector_record` / `query_vector_store` の LRU 更新時。または `SF_AI_AUTO_MEMORY=1` 設定時は全ツール実行ごとに `tool:<name>` タグ付きレコードを自動追加 | `memory/vector-store.ts`, `mcp/core/governance/governed-tool-registrar.ts` |
| `outputs/resource-governance.json` | JSON (上書き) | `apply_resource_actions` で governance state が変わった時 | `mcp/server.ts` |
| `outputs/operations-log.jsonl` | JSONL (追記) | governance 変更操作のたびに 1 行追加 | `mcp/core/governance/operation-log.ts` |
| `outputs/execution-origins.jsonl` | JSONL (追記) | 各ツール実行の成功/失敗ごとに 1 行追加。`repoPath` / `rootDir` / `filePath(s)` から repo 候補を抽出し、server 側の repo root とあわせて記録 | `mcp/core/governance/governed-tool-registrar.ts` |
| `outputs/events/system-events.jsonl` | JSONL (追記) | `emitSystemEvent` 経由 (chat / orchestrate / governance / cleanup 等の節目) | `mcp/core/event/system-event-manager.ts` |
| `outputs/events/system-events.<stamp>.<nonce>.jsonl` | JSONL (ローテ後) | size/age 上限超過で rotate された時 | 同上 |
| `outputs/events/trace-log.jsonl` | JSONL (上書き) | `endTrace` / `failTrace` で履歴を全件 dump (chat / orchestrate / 各種ツール終端) | `mcp/core/trace/trace-context.ts` |
| `outputs/events/metrics-samples.jsonl` | JSONL (上書き) | 各ツール終了時に sample を追加 → flush | `mcp/tools/metrics.ts` |
| `outputs/history/YYYY-MM-DD/<id>.json` | JSON | `record_agent_message` / `parse_and_record_chat` 実行時 | `mcp/core/context/history-store.ts` |
| `outputs/history/archive/YYYY-MM-DD.json` | JSON | `npm run history:archive` または `archive_history` ツール実行時 | `scripts/archive-history.ts` |
| `outputs/sessions/<sessionId>.json` | JSON | `orchestrate_chat` 開始時 + `evaluate_triggers` / `dequeue_next_agent` で更新 | `mcp/core/context/orchestration-session-store.ts` |
| `outputs/presets/<name>/v<n>.json`, `latest.json` | JSON | `create_preset` / `update_preset` 実行時 | `mcp/core/context/preset-store.ts` |
| `outputs/audit/*.jsonl` | JSONL (追記) | `apply_resource_actions` の監査ログ書き込み時 | `mcp/handlers/register-resource-action-tools.ts` |
| `outputs/tool-proposals/proposal-feedback.jsonl` / `proposal-feedback-model.json` | JSONL + JSON | `proposal_feedback_learn` 実行時 | `mcp/core/resource/proposal-feedback.ts` |
| `outputs/reports/skill-rating.jsonl` / `skill-rating.json` / `skill-rating.md` | JSONL + JSON + Markdown | `record_skill_rating` / `get_skill_rating_report` 実行時 | `mcp/core/resource/skill-rating.ts`, `mcp/handlers/register-resource-search-tools.ts` |
| `outputs/tool-proposals/query-skill-feedback.jsonl` / `query-skill-model.json` | JSONL + JSON | `proposal_feedback_learn` 実行時。skills 提案の `topic` を query として漸進学習 | `mcp/core/resource/query-skill-incremental.ts`, `mcp/handlers/register-resource-governance-tools.ts` |
| `outputs/agent-trust-histories.json` | JSON | `agent_ab_test` の trust 反映時 / `applyAbTestOutcome` 呼び出し時 | `mcp/core/quality/agent-trust-store.ts` |
| `outputs/dashboards/observability.{html,md,json}` | 各形式 | `observability_dashboard` ツール実行時のみ (TASK-044) | `mcp/handlers/register-analytics-tools.ts` |
| `outputs/reports/benchmark-suite.json` | JSON | `npm run benchmark:run` または `benchmark_suite` ツール実行時 | `scripts/benchmark-suite.ts` |
| `outputs/reports/agent-ab-test/runs.jsonl` + `latest.{json,md}` | JSONL (追記) + 上書き | `agent_ab_test` ツール実行時。`runs.jsonl` に 1 行 = 1 実行を append、`latest.{json,md}` は直近 1 件で上書き (3 ファイル固定) | `mcp/tools/agent-ab-test.ts` |
| `outputs/reports/test-coverage-gap/*.{json,md}` | JSON + MD | `analyze_test_coverage_gap` ツール実行時 | `mcp/tools/analyze-test-coverage-gap.ts` |
| `outputs/reports/recommend-permission-sets/*.{json,md}` | JSON + MD | `recommend_permission_sets` ツール実行時 | `mcp/tools/recommend-permission-sets.ts` |
| `outputs/reports/resource-dependency-graph/*.{json,mmd}` | JSON + Mermaid | `resource_dependency_graph` ツール実行時 | `mcp/tools/resource-dependency-graph.ts` |
| `outputs/reports/run-deployment-verification/*.{json,md}` | JSON + MD | `run_deployment_verification` ツール実行時 | `mcp/tools/run-deployment-verification.ts` |
| `outputs/reports/suggest-flow-test-cases/*.{json,md}` | JSON + MD | `suggest_flow_test_cases` ツール実行時 | `mcp/tools/suggest-flow-test-cases.ts` |
| `outputs/reports/cleanup/*.{json,md}` | JSON + MD | `suggest_cleanup_resources` ツール実行時 (TASK-039) | `mcp/handlers/register-resource-action-tools.ts` |
| `outputs/reports/skill-auto-classify.json` | JSON (上書き) | `npm run skills:classify` (T-ADD-07) | `scripts/skill-auto-classify.ts` |
| `outputs/skill-rating-report.md` | Markdown | `auto_select_resources` / 関連リソース検索時 | `mcp/handlers/register-resource-search-tools.ts` |
| `outputs/cleanup-schedule.json` | JSON | `governance_auto_cleanup_schedule` ツール実行時 (TASK-041) | `mcp/core/resource/cleanup-scheduler.ts` |
| `outputs/prompt-cache.jsonl` | JSONL (追記/圧縮) | `PROMPT_CACHE_FILE` 設定時、プロンプトキャッシュ追加/退避ごと (TASK-046) | `mcp/core/context/prompt-cache-persistence.ts` |
| `outputs/benchmark/<stamp>.json` / `latest.json` | JSON | nightly CI (`benchmark-nightly.yml`) 実行時 (TASK-050) | `scripts/benchmark-suite.ts` |
| `outputs/backups/<snapshot>/...` | フォルダ世代 | `npm run outputs:version -- backup` または auto-apply 削除前 | `mcp/core/governance/outputs-versioning.ts` |
| `outputs/custom-tools/*.json` | JSON (`DeclarativeToolSpec`) | `apply_resource_actions` または提案フロー (`apply_proposal` / `auto_apply_pending_proposals`) で作成時 | `mcp/handlers/register-resource-action-tools.ts`, `mcp/core/resource/proposal-applier.ts`, `mcp/core/declarative/loader.ts` (起動時に動的登録) |
| `outputs/tool-proposals/{pending,approved,rejected}/<id>.json` | JSON | `enqueue_proposal` でキュー → `approve_proposal` / `apply_proposal` / `reject_proposal` / `auto_apply_pending_proposals` で状態遷移 | `mcp/core/resource/proposal-queue.ts`, `mcp/core/resource/proposal-applier.ts`, `mcp/core/resource/auto-create-gate.ts` |

### 書き込みパターンの分類

| パターン | 例 | 特徴 |
|---------|----|------|
| 常時 append | `system-events.jsonl`, `operations-log.jsonl`, `audit/*.jsonl`, `*-feedback.jsonl` | イベント発火ごとに 1 行追加。ローテーションあり |
| 常時 overwrite (全件 dump) | `trace-log.jsonl`, `metrics-samples.jsonl` | flush のたび履歴メモリ全件を書き直し |
| State 更新時のみ overwrite | `resource-governance.json`, `agent-trust-histories.json`, `cleanup-schedule.json` | 設定/状態が変わった時だけ |
| キー単位の新規ファイル | `history/<date>/<id>.json`, `sessions/<id>.json`, `presets/<name>/v<n>.json` | 1 イベント = 1 ファイル |
| ツール手動実行のみ | `dashboards/observability.*`, `reports/**` | 該当ツール / スクリプトを呼んだ時だけ |
| CI/スクリプト経由のみ | `benchmark/<stamp>.json`, `backups/**`, `history/archive/**` | 手動 or scheduler 起動 |
| 環境変数で活性化 | `prompt-cache.jsonl` (`PROMPT_CACHE_FILE` 必須) | 既定 OFF |

### ざっくり目安

- **MCP サーバを起動するだけ**で書き換わるファイルはありません（全て何らかのツール実行をトリガに）。
- **`chat` / `orchestrate_chat` を 1 回叩く** と更新: `system-events`, `trace-log`, `metrics-samples`, `history/`, `sessions/` (orchestrate のみ)。
- **静的解析・差分系ツール** を叩くと更新: 上記 events 系 + 該当 `reports/**`。
- **ガバナンス系**: `resource-governance.json`, `operations-log.jsonl`, `audit/`, 必要なら `backups/`。
- **手動コマンド**: `outputs:version` (`backups/`), `history:archive` (`history/archive/`), `benchmark:run` (`reports/benchmark-suite.json`)。
- **CI**: `benchmark-nightly` ワークフローが `outputs/benchmark/` を更新。

## allow-list (`outputs/.schema.json`) と Lint

`outputs/` 直下に置けるディレクトリ・ファイル名は [`outputs/.schema.json`](../outputs/.schema.json) で**ホワイトリスト**として宣言されています (TASK-F12)。

- `allowedDirectories`: トップレベルのサブディレクトリ名 (`history`, `events`, `sessions`, `orgs` など)。
- `allowedFiles`: トップレベルに置けるファイル名 (`memory.jsonl`, `vector-store.jsonl`, `tool-catalog.json` など)。
- 検査は **トップレベルの完全一致のみ**。サブツリー内のファイル構造はチェックしません。

### Lint の実行

```bash
npm run lint:outputs
```

[`scripts/lint-outputs.ts`](../scripts/lint-outputs.ts) がこのスキーマを読み込み、`outputs/` 直下に未許可エントリが存在すれば差分を報告します。

### 新しい永続化先を追加するとき

1. 実装側で書き込みパスを決める (例: `outputs/foo-bar/`)。
2. [`outputs/.schema.json`](../outputs/.schema.json) の `allowedDirectories` または `allowedFiles` に追記する。
3. このページの「フォルダ構成」「自動で保存されるもの／されないもの」表にも 1 行追加する。
4. `npm run lint:outputs` で差分が無いことを確認。
