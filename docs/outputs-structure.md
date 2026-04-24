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
| `outputs/benchmark/` | nightly benchmark の結果 (TASK-050) | grade 推移や regress を確認するとき |
| `outputs/dashboards/` | observability ダッシュボード (TASK-044) | 横断的な健全性を可視化したいとき |
| `outputs/reports/` | 各種スクリプトのレポート出力 | benchmark 単発実行や coverage gap などを確認したいとき |

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

### 消してよい例

- 古い `history/` と `sessions/`（運用ルールに従う）
- 一時検証で作った不要 JSON

### 消さないほうがよい例

- `events/system-events.jsonl`
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

## 各ファイル / ディレクトリの更新タイミング

「いつ書き換わるか」をツール / コマンド単位で整理した一覧です。
障害調査や差分確認時に、どこを見れば変化が見えるかの目安になります。

| パス | 形式 | 更新タイミング | 主な書き込み元 |
|------|------|----------------|----------------|
| `outputs/memory.jsonl` | JSONL (追記) | `add_memory` / `clear_memory` 実行時。または `SF_AI_AUTO_MEMORY=1` 設定時は全ツール実行成功/失敗ごとに input/output サマリを自動追記 | `memory/project-memory.ts`, `mcp/core/governance/governed-tool-registrar.ts` |
| `outputs/vector-store.jsonl` | JSONL (追記/再書き) | `add_vector_record` / `query_vector_store` の LRU 更新時。または `SF_AI_AUTO_MEMORY=1` 設定時は全ツール実行ごとに `tool:<name>` タグ付きレコードを自動追加 | `memory/vector-store.ts`, `mcp/core/governance/governed-tool-registrar.ts` |
| `outputs/resource-governance.json` | JSON (上書き) | `apply_resource_actions` で governance state が変わった時 | `mcp/server.ts` |
| `outputs/operations-log.jsonl` | JSONL (追記) | governance 変更操作のたびに 1 行追加 | `mcp/core/governance/operation-log.ts` |
| `outputs/events/system-events.jsonl` | JSONL (追記) | `emitSystemEvent` 経由 (chat / orchestrate / governance / cleanup 等の節目) | `mcp/core/event/system-event-manager.ts` |
| `outputs/events/system-events.<stamp>.<nonce>.jsonl` | JSONL (ローテ後) | size/age 上限超過で rotate された時 | 同上 |
| `outputs/events/trace-log.jsonl` | JSONL (上書き) | `endTrace` / `failTrace` で履歴を全件 dump (chat / orchestrate / 各種ツール終端) | `mcp/core/trace/trace-context.ts` |
| `outputs/events/metrics-samples.jsonl` | JSONL (上書き) | 各ツール終了時に sample を追加 → flush | `mcp/tools/metrics.ts` |
| `outputs/history/YYYY-MM-DD/<id>.json` | JSON | `record_agent_message` / `parse_and_record_chat` 実行時 | `mcp/core/context/history-store.ts` |
| `outputs/history/archive/YYYY-MM-DD.json` | JSON | `npm run history:archive` または `archive_history` ツール実行時 | `scripts/archive-history.ts` |
| `outputs/sessions/<sessionId>.json` | JSON | `orchestrate_chat` 開始時 + `evaluate_triggers` / `dequeue_next_agent` で更新 | `mcp/core/context/orchestration-session-store.ts` |
| `outputs/presets/<name>/v<n>.json`, `latest.json` | JSON | `create_preset` / `update_preset` 実行時 | `mcp/core/context/preset-store.ts` |
| `outputs/audit/*.jsonl` | JSONL (追記) | `apply_resource_actions` の監査ログ書き込み時 | `mcp/handlers/register-resource-action-tools.ts` |
| `outputs/tool-proposals/*.jsonl` / `proposal-model.json` | JSONL + JSON | 提案フィードバック (`record_resource_signal` など) 実行時 | `mcp/core/resource/proposal-feedback.ts` |
| `outputs/skill-rating/*.jsonl` / model | JSONL + JSON | スキル評価フィードバック更新時 | `mcp/core/resource/skill-rating.ts` |
| `outputs/query-skill-incremental.jsonl` / model | JSONL + JSON | `auto_select_resources` 等の漸進学習時 | `mcp/core/resource/query-skill-incremental.ts` |
| `outputs/agent-trust-histories.json` | JSON | `agent_ab_test` の trust 反映時 / `applyAbTestOutcome` 呼び出し時 | `mcp/core/quality/agent-trust-store.ts` |
| `outputs/dashboards/observability.{html,md,json}` | 各形式 | `observability_dashboard` ツール実行時のみ (TASK-044) | `mcp/handlers/register-analytics-tools.ts` |
| `outputs/reports/benchmark-suite.json` | JSON | `npm run benchmark:run` または `benchmark_suite` ツール実行時 | `scripts/benchmark-suite.ts` |
| `outputs/reports/agent-ab-test/*.{json,md}` | JSON + MD | `agent_ab_test` ツール実行時 | `mcp/tools/agent-ab-test.ts` |
| `outputs/reports/test-coverage-gap/*.{json,md}` | JSON + MD | `analyze_test_coverage_gap` ツール実行時 | `mcp/tools/analyze-test-coverage-gap.ts` |
| `outputs/reports/recommend-permission-sets/*.{json,md}` | JSON + MD | `recommend_permission_sets` ツール実行時 | `mcp/tools/recommend-permission-sets.ts` |
| `outputs/reports/resource-dependency-graph/*.{json,mmd}` | JSON + Mermaid | `resource_dependency_graph` ツール実行時 | `mcp/tools/resource-dependency-graph.ts` |
| `outputs/reports/run-deployment-verification/*.{json,md}` | JSON + MD | `run_deployment_verification` ツール実行時 | `mcp/tools/run-deployment-verification.ts` |
| `outputs/reports/suggest-flow-test-cases/*.{json,md}` | JSON + MD | `suggest_flow_test_cases` ツール実行時 | `mcp/tools/suggest-flow-test-cases.ts` |
| `outputs/reports/cleanup/*.{json,md}` | JSON + MD | `suggest_cleanup_resources` ツール実行時 (TASK-039) | `mcp/handlers/register-resource-action-tools.ts` |
| `outputs/skill-rating-report.md` | Markdown | `auto_select_resources` / 関連リソース検索時 | `mcp/handlers/register-resource-search-tools.ts` |
| `outputs/cleanup-schedule.json` | JSON | `governance_auto_cleanup_schedule` ツール実行時 (TASK-041) | `mcp/core/resource/cleanup-scheduler.ts` |
| `outputs/prompt-cache.jsonl` | JSONL (追記/圧縮) | `PROMPT_CACHE_FILE` 設定時、プロンプトキャッシュ追加/退避ごと (TASK-046) | `mcp/core/context/prompt-cache-persistence.ts` |
| `outputs/benchmark/<stamp>.json` / `latest.json` | JSON | nightly CI (`benchmark-nightly.yml`) 実行時 (TASK-050) | `scripts/benchmark-suite.ts` |
| `outputs/backups/<snapshot>/...` | フォルダ世代 | `npm run outputs:version -- backup` または auto-apply 削除前 | `mcp/core/governance/outputs-versioning.ts` |
| `outputs/custom-tools/*.json` | JSON | `apply_resource_actions` で custom tool 作成時 | `mcp/handlers/register-resource-action-tools.ts` |

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
