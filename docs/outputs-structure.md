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
| `outputs/agent-graph.jsonl` | agent 遷移学習ログ | `dequeue_next_agent` の推奨根拠を確認するとき |
| `outputs/audit/tool-executions.jsonl` | ツール実行監査ログ | 実行拒否やポリシー判定を追跡するとき |
| `outputs/tool-proposals/` | 提案学習ログ | 推薦精度の分析をするとき |
| `outputs/tool-proposals/pending/` | リソース作成提案 (保留中) | `list_proposals` / `approve_proposal` (既定で即時適用) / `apply_proposal` / `auto_apply_pending_proposals` の対象 |
| `outputs/tool-proposals/approved/` | リソース作成提案 (承認済 audit) | 承認履歴の追跡 |
| `outputs/tool-proposals/rejected/` | リソース作成提案 (却下 audit) | 却下理由つき履歴 |
| `outputs/benchmark/` | nightly benchmark の結果 (TASK-050) | grade 推移や regress を確認するとき |
| `outputs/dashboards/` | observability ダッシュボード (TASK-044) | 横断的な健全性を可視化したいとき |
| `outputs/reports/` | 各種スクリプトのレポート出力 | benchmark 単発実行や coverage gap などを確認したいとき |
| `outputs/orgs/` | Salesforce Org カタログ (`catalog.json`) | `register_org` / `list_orgs` で参照 |
| `outputs/.schema.json` | outputs 直下の allow-list (TASK-F12) | 新しい永続化先を追加した時に更新 |

## ⚠️ 重要：SF_AI_OUTPUTS_DIR 設定

**複数リポジトリから MCP サーバが起動される場合、必ず `SF_AI_OUTPUTS_DIR` を絶対パスで指定してください。**

### 背景

各レポート生成ツール（coverage-gap, drift, permission-sets, deployment-verification, flow-test-cases など）は、`SF_AI_OUTPUTS_DIR` から出力先を取得します。

- **設定なし**：cwd ベースの相対パス解決 → 起動元リポジトリの `outputs/` に保存
  ```
  # docutize_form から起動した場合
  d:\Projects\docutize_form\outputs\reports\coverage-gap\  ← ❌ 間違い
  ```

- **`SF_AI_OUTPUTS_DIR` 指定**：絶対パス指定で固定的に出力
  ```
  # どのリポジトリから起動しても
  d:\Projects\mult-agent-ai\salesforce-ai-company\outputs\reports\coverage-gap\  ← ✅ 正しい
  ```

### 設定方法

**方法 1: `.env` ファイル（推奨）**
```env
SF_AI_OUTPUTS_DIR=D:/Projects/mult-agent-ai/salesforce-ai-company/outputs
```

**方法 2: `claude_desktop_config.json`**
```json
{
  "mcpServers": {
    "salesforce-ai-company": {
      "command": "node",
      "args": ["D:/Projects/mult-agent-ai/salesforce-ai-company/dist/mcp/server.js"],
      "env": {
        "SF_AI_DOTENV_PATH": "D:/Projects/mult-agent-ai/salesforce-ai-company/.env"
      }
    }
  }
}
```

**方法 3: OS 環境変数**
```powershell
[Environment]::SetEnvironmentVariable('SF_AI_OUTPUTS_DIR', 'D:\Projects\mult-agent-ai\salesforce-ai-company\outputs', 'User')
```

### `outputs/history/` の日別運用

- チャット履歴は `outputs/history/YYYY-MM-DD/<historyId>.json` に保存されます。
- 日次アーカイブは `npm run history:archive -- --date=YYYY-MM-DD` で実行します。
- アーカイブ実行後は次が生成されます。
	- `outputs/history/archive/YYYY-MM-DD.json`
	- `outputs/history/archive/YYYY-MM-DD-summary.md`

## 削除してよいもの・だめなもの

### 基本ルール

- 手動削除より、まず `npm run ai -- outputs:cleanup -- --dry-run` を使う
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
npm run ai -- doctor

# 古い履歴を整理（まずは確認だけ）
npm run ai -- outputs:cleanup -- --dry-run

# バックアップ作成
npm run ai -- outputs:version -- backup

# バックアップ一覧
npm run ai -- outputs:version -- list

# backups を残して outputs を空にする
npm run ai -- outputs:version -- wipe --keep-backups

# 復元
npm run ai -- outputs:version -- restore --snapshot <snapshot-id>

# 可観測性ダッシュボード再生成
npm run ai -- observability:dashboard -- --trace-limit 200 --event-limit 1000
```

## 障害時の最短手順

1. `npm run ai -- doctor` を実行
2. `outputs/events/system-events.jsonl` を確認
3. 必要なら `outputs:version` で直近バックアップへ復元
4. 復元後に再度 `npm run ai -- doctor`

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
| `outputs/agent-graph.jsonl` | `dequeue_next_agent` でキューが空になり、履歴長が 2 以上の時 | agent シーケンスを継続学習として追記 |
| `outputs/resource-governance.json` | governance state が変わった時 | apply_resource_actions 等 |
| `outputs/operations-log.jsonl` | governance 変更操作時 | 監査寄りの操作ログ |
| `outputs/audit/*.jsonl` | `apply_resource_actions` やツール実行時 | リソース変更・実行拒否を含む監査ログ |
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
| `outputs/backups/<snapshot>/...` | `npm run ai -- outputs:version -- backup` / `wipe` 前の事前 snapshot / restore 前の事前 snapshot | 手動コマンド中心 |
| `outputs/history/archive/YYYY-MM-DD.json` | `npm run history:archive` / `archive_history` | 日次アーカイブ |
| `outputs/history/archive/YYYY-MM-DD-summary.md` | `npm run history:archive` / `archive_history` | 日次サマリ |
| `outputs/dashboards/observability.{html,md,json}` | `observability_dashboard` 実行時 | 可観測性ダッシュボード |
| `outputs/reports/benchmark-suite.json` | `npm run benchmark:run` / `benchmark_suite` | 単発ベンチ |
| `outputs/reports/agent-ab-test/runs.jsonl`, `latest.{json,md}` | `agent_ab_test` 実行時 | A/B 比較レポート |
| `outputs/reports/coverage-gap/runs.jsonl`, `latest.{json,md}` | `analyze_test_coverage_gap` 実行時 | 実行履歴 + 直近結果 |
| `outputs/reports/permission-set-recommendations/runs.jsonl`, `latest.{json,md}` | `recommend_permission_sets` 実行時 | 実行履歴 + 直近結果 |
| `outputs/reports/resource-dependency-graph/*.{json,mmd}` | `resource_dependency_graph` 実行時 | 手動解析結果 |
| `outputs/reports/deployment-verification/runs.jsonl`, `latest.{json,md}` | `run_deployment_verification` 実行時 | 実行履歴 + 直近結果 |
| `outputs/reports/flow-test-cases/runs.jsonl`, `latest.{json,md}` | `suggest_flow_test_cases` 実行時 | 実行履歴 + 直近結果 |
| `outputs/reports/cleanup-suggestions/runs.jsonl`, `latest.{json,md}` | `suggest_cleanup_resources` 実行時 | 実行履歴 + 直近結果 |
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
| `outputs/agent-graph.jsonl` | JSONL (追記) | `dequeue_next_agent` で queue が空になった時に、完了 session の agent 履歴を学習用に追記 | `mcp/core/learning/agent-graph-learner.ts`, `mcp/handlers/register-chat-orchestration-tools.ts` |
| `outputs/execution-origins.jsonl` | JSONL (追記) | 各ツール実行の成功/失敗ごとに 1 行追加。`repoPath` / `rootDir` / `filePath(s)` から repo 候補を抽出し、server 側の repo root とあわせて記録 | `mcp/core/governance/governed-tool-registrar.ts` |
| `outputs/events/system-events.jsonl` | JSONL (追記) | `emitSystemEvent` 経由 (chat / orchestrate / governance / cleanup 等の節目) | `mcp/core/event/system-event-manager.ts` |
| `outputs/events/system-events.<stamp>.<nonce>.jsonl` | JSONL (ローテ後) | size/age 上限超過で rotate された時 | 同上 |
| `outputs/events/trace-log.jsonl` | JSONL (上書き) | `endTrace` / `failTrace` で履歴を全件 dump (chat / orchestrate / 各種ツール終端) | `mcp/core/trace/trace-context.ts` |
| `outputs/events/metrics-samples.jsonl` | JSONL (上書き) | 各ツール終了時に sample を追加 → flush | `mcp/tools/metrics.ts` |
| `outputs/history/YYYY-MM-DD/<id>.json` | JSON | `record_agent_message` / `parse_and_record_chat` 実行時 | `mcp/core/context/history-store.ts` |
| `outputs/history/archive/YYYY-MM-DD.json` | JSON | `npm run history:archive` または `archive_history` ツール実行時 | `scripts/archive-history.ts` |
| `outputs/sessions/<sessionId>.json` | JSON | `orchestrate_chat` 開始時 + `evaluate_triggers` / `dequeue_next_agent` で更新 | `mcp/core/context/orchestration-session-store.ts` |
| `outputs/presets/<name>/v<n>.json`, `latest.json` | JSON | `create_preset` / `update_preset` 実行時 | `mcp/core/context/preset-store.ts` |
| `outputs/audit/*.jsonl` | JSONL (追記) | `apply_resource_actions` とツール実行ガバナンス判定時の監査ログ書き込み | `mcp/handlers/register-resource-action-tools.ts`, `mcp/core/governance/governed-tool-registrar.ts` |
| `outputs/tool-proposals/proposal-feedback.jsonl` / `proposal-feedback-model.json` | JSONL + JSON | `proposal_feedback_learn` 実行時 | `mcp/core/resource/proposal-feedback.ts` |
| `outputs/reports/skill-rating.jsonl` / `skill-rating.json` / `skill-rating.md` | JSONL + JSON + Markdown | `record_skill_rating` / `get_skill_rating_report` 実行時 | `mcp/core/resource/skill-rating.ts`, `mcp/handlers/register-resource-search-tools.ts` |
| `outputs/tool-proposals/query-skill-feedback.jsonl` / `query-skill-model.json` | JSONL + JSON | `proposal_feedback_learn` 実行時。skills 提案の `topic` を query として漸進学習 | `mcp/core/resource/query-skill-incremental.ts`, `mcp/handlers/register-resource-governance-tools.ts` |
| `outputs/agent-trust-histories.json` | JSON | `agent_ab_test` の trust 反映時 / `applyAbTestOutcome` 呼び出し時 | `mcp/core/quality/agent-trust-store.ts` |
| `outputs/dashboards/observability.{html,md,json}` | 各形式 | `observability_dashboard` ツール実行時のみ (TASK-044) | `mcp/handlers/register-analytics-tools.ts` |
| `outputs/reports/benchmark-suite.json` | JSON | `npm run benchmark:run` または `benchmark_suite` ツール実行時 | `scripts/benchmark-suite.ts` |
| `outputs/reports/agent-ab-test/runs.jsonl` + `latest.{json,md}` | JSONL (追記) + 上書き | `agent_ab_test` ツール実行時。`runs.jsonl` に 1 行 = 1 実行を append、`latest.{json,md}` は直近 1 件で上書き (3 ファイル固定) | `mcp/tools/agent-ab-test.ts` |
| `outputs/reports/coverage-gap/runs.jsonl` + `latest.{json,md}` | JSONL (追記) + JSON/MD (上書き) | `analyze_test_coverage_gap` ツール実行時 | `mcp/tools/analyze-test-coverage-gap.ts` |
| `outputs/reports/permission-set-recommendations/runs.jsonl` + `latest.{json,md}` | JSONL (追記) + JSON/MD (上書き) | `recommend_permission_sets` ツール実行時 | `mcp/tools/recommend-permission-sets.ts` |
| `outputs/reports/resource-dependency-graph/*.{json,mmd}` | JSON + Mermaid | `resource_dependency_graph` ツール実行時 | `mcp/tools/resource-dependency-graph.ts` |
| `outputs/reports/deployment-verification/runs.jsonl` + `latest.{json,md}` | JSONL (追記) + JSON/MD (上書き) | `run_deployment_verification` ツール実行時 | `mcp/tools/run-deployment-verification.ts` |
| `outputs/reports/flow-test-cases/runs.jsonl` + `latest.{json,md}` | JSONL (追記) + JSON/MD (上書き) | `suggest_flow_test_cases` ツール実行時 | `mcp/tools/suggest-flow-test-cases.ts` |
| `outputs/reports/cleanup-suggestions/runs.jsonl` + `latest.{json,md}` | JSONL (追記) + JSON/MD (上書き) | `suggest_cleanup_resources` ツール実行時 (TASK-039) | `mcp/handlers/register-resource-action-tools.ts` |
| `outputs/reports/skill-auto-classify.json` | JSON (上書き) | `npm run skills:classify` (T-ADD-07) | `scripts/skill-auto-classify.ts` |
| `outputs/skill-rating-report.md` | Markdown | `auto_select_resources` / 関連リソース検索時 | `mcp/handlers/register-resource-search-tools.ts` |
| `outputs/cleanup-schedule.json` | JSON | `governance_auto_cleanup_schedule` ツール実行時 (TASK-041) | `mcp/core/resource/cleanup-scheduler.ts` |
| `outputs/prompt-cache.jsonl` | JSONL (追記/圧縮) | `PROMPT_CACHE_FILE` 設定時、プロンプトキャッシュ追加/退避ごと (TASK-046) | `mcp/core/context/prompt-cache-persistence.ts` |
| `outputs/benchmark/<stamp>.json` / `latest.json` | JSON | nightly CI (`benchmark-nightly.yml`) 実行時 (TASK-050) | `scripts/benchmark-suite.ts` |
| `outputs/backups/<snapshot>/...` | フォルダ世代 | `npm run ai -- outputs:version -- backup` または auto-apply 削除前 | `mcp/core/governance/outputs-versioning.ts` |
| `outputs/custom-tools/*.json` | JSON (`DeclarativeToolSpec`) | `apply_resource_actions` または提案フロー (`apply_proposal` / `auto_apply_pending_proposals`) で作成時 | `mcp/handlers/register-resource-action-tools.ts`, `mcp/core/resource/proposal-applier.ts`, `mcp/core/declarative/loader.ts` (起動時に動的登録) |
| `outputs/tool-proposals/{pending,approved,rejected}/<id>.json` | JSON | `enqueue_proposal` でキュー → `approve_proposal` / `apply_proposal` / `reject_proposal` / `auto_apply_pending_proposals` で状態遷移 | `mcp/core/resource/proposal-queue.ts`, `mcp/core/resource/proposal-applier.ts`, `mcp/core/resource/auto-create-gate.ts` |

### 各ファイルで保存される主な属性（キー）

「このファイルには何が入るか」を、主要キー名ベースで確認できる一覧です。
調査時はまずこの表で当たりを付け、必要に応じて対象ファイルを開いてください。

| パス | 主な属性（キー） | メモ |
|------|------------------|------|
| `outputs/bandit-state.jsonl` | `name`, `alpha`, `beta` | 1 行 = 1 arm。終了時保存・起動時読込 |
| `outputs/execution-origins.jsonl` | `timestamp`, `toolName`, `status`, `serverRoot`, `processCwd`, `repoRoots`, `inputPathHints` | 実行 provenance ログ |
| `outputs/memory.jsonl` | `text`, `savedAt` | 1 行 = 1 メモ |
| `outputs/vector-store.jsonl` | `id`, `text`, `tags` | 1 行 = 1 レコード |
| `outputs/resource-governance.json` | `config`, `usage`, `bugSignals`, `disabled`, `lifecycle`, `updatedAt` | ガバナンス状態の単一スナップショット |
| `outputs/operations-log.jsonl` | `type`, `resourceType`, `name`, `timestamp` | リソース操作ログ |
| `outputs/agent-graph.jsonl` | `recordedAt`, `sessionId`, `sequence`, `success` | agent 遷移学習ログ |
| `outputs/events/system-events.jsonl` | `id`, `event`, `timestamp`, `payload` | `payload` はイベントごとに可変 |
| `outputs/events/trace-log.jsonl` | `traceId`, `toolName`, `startedAt`, `endedAt`, `durationMs`, `status`, `errorMessage`, `metadata`, `phases` | trace の完了履歴 |
| `outputs/events/metrics-samples.jsonl` | `toolName`, `traceId`, `startedAt`, `durationMs`, `status`, `cacheHit` | ツール実行サンプル |
| `outputs/history/YYYY-MM-DD/<id>.json` | `id`, `timestamp`, `topic`, `agents`, `entries[]` | `entries[]`: `agent`, `message`, `timestamp`, `topic?` |
| `outputs/sessions/<sessionId>.json` | `id`, `topic`, `agents`, `persona`, `skills`, `filePaths`, `turns`, `triggerRules`, `queue`, `history`, `firedRules`, `dag`, `agentTrust` | オーケストレーション状態 |
| `outputs/prompt-cache.jsonl` | `key`, `prompt`, `createdAt`, `input` | `input` は prompt 入力の可変オブジェクト |
| `outputs/agent-trust-histories.json` | `updatedAt`, `histories` | `histories.<agent>` に `accepted`, `rejected` |
| `outputs/orgs/catalog.json` | `version`, `updatedAt`, `orgs[]` | `orgs[]`: `alias`, `instanceUrl`, `type`, `tags?`, `notes?`, `registeredAt`, `lastSeenAt?`, `metadata?` |
| `outputs/tool-proposals/proposal-feedback.jsonl` | `resourceType`, `name`, `decision`, `topic?`, `note?`, `recordedAt` | 提案採否フィードバック |
| `outputs/tool-proposals/proposal-feedback-model.json` | `updatedAt`, `minSamples`, `totals`, `typeAdjustments`, `resources[]` | `resources[]` は採否統計 |
| `outputs/tool-proposals/query-skill-feedback.jsonl` | `query`, `skill`, `decision`, `recordedAt` | query-skill 学習ログ |
| `outputs/tool-proposals/query-skill-model.json` | `modelVersion`, `updatedAt`, `totals`, `skills[]` | `skills[]` に `bias`, `tokenWeights` |
| `outputs/reports/skill-rating.jsonl` | `skill`, `rating`, `topic?`, `note?`, `recordedAt` | スキル評価の生ログ |
| `outputs/reports/skill-rating.json` | `updatedAt`, `params`, `totals`, `skills[]` | 集計済みレポート |

#### 属性の意味（クイック辞典）

`outputs/bandit-state.jsonl`

- `name`: 学習対象リソース名（arm 名）
- `alpha`: 成功側パラメータ（大きいほど成功寄り）
- `beta`: 失敗側パラメータ（大きいほど失敗寄り）

`outputs/execution-origins.jsonl`

- `timestamp`: 実行記録時刻（ISO）
- `toolName`: 実行されたツール名
- `status`: 実行結果（success / error）
- `serverRoot`: サーバー基準のリポジトリルート
- `processCwd`: 実行時カレントディレクトリ
- `repoRoots`: 推定された関連リポジトリルート一覧
- `inputPathHints`: 入力由来の絶対パス候補

`outputs/memory.jsonl`

- `text`: 保存されたメモ本文
- `savedAt`: 保存時刻（ISO）

`outputs/vector-store.jsonl`

- `id`: レコード ID（一意キー）
- `text`: 検索対象テキスト
- `tags`: 検索補助タグ配列

`outputs/resource-governance.json`

- `config`: ガバナンス設定（上限・閾値・自動化設定）
- `usage`: 種別ごとの利用回数マップ
- `bugSignals`: 種別ごとの不具合シグナル回数マップ
- `disabled`: 種別ごとの無効化リソース名一覧
- `lifecycle`: 種別ごとのライフサイクル状態（experimental など）
- `updatedAt`: 最終更新時刻（ISO）

`outputs/operations-log.jsonl`

- `type`: 操作種別（create / delete / disable / enable）
- `resourceType`: 対象種別（skills / tools / presets）
- `name`: 対象リソース名
- `timestamp`: 操作時刻（ISO）

`outputs/agent-graph.jsonl`

- `recordedAt`: 学習記録時刻（ISO）
- `sessionId`: 元セッション ID（ある場合）
- `sequence`: エージェント遷移順序
- `success`: 成否フラグ（false は低重みで学習）

`outputs/events/system-events.jsonl`

- `id`: イベント ID
- `event`: イベント種別（session_start など）
- `timestamp`: 発火時刻（ISO）
- `payload`: イベント固有の詳細情報

`outputs/events/trace-log.jsonl`

- `traceId`: トレース ID
- `toolName`: 対象ツール名
- `startedAt` / `endedAt`: 開始・終了時刻（ISO）
- `durationMs`: 実行時間（ms）
- `status`: 実行状態（running / success / error）
- `errorMessage`: エラー時メッセージ
- `metadata`: 任意メタ情報
- `phases`: フェーズ別計測（input/plan/execute/render）

`outputs/events/metrics-samples.jsonl`

- `toolName`: ツール名
- `traceId`: 紐づくトレース ID（ある場合）
- `startedAt`: 実行開始時刻（ISO）
- `durationMs`: 実行時間（ms）
- `status`: 成否（success / error）
- `cacheHit`: キャッシュヒット有無

`outputs/history/YYYY-MM-DD/<id>.json`

- `id`: 履歴 ID
- `timestamp`: 保存時刻（ISO）
- `topic`: 会話トピック
- `agents`: セッションに登場したエージェント一覧
- `entries[]`: 会話ログ配列（`agent`, `message`, `timestamp`, `topic?`）

`outputs/sessions/<sessionId>.json`

- `id`: セッション ID
- `topic`: テーマ
- `agents`: 対象エージェント一覧
- `persona`: 指定ペルソナ（ある場合）
- `skills`: 利用スキル一覧
- `filePaths`: 文脈に含めたファイル一覧
- `turns`: ターン数
- `triggerRules`: トリガールール設定
- `queue`: 実行待ちエージェントキュー
- `history`: セッション内メッセージ履歴
- `firedRules`: 発火済みルール記録
- `dag`: 依存実行設定（有効時）
- `agentTrust`: エージェント別信頼スコア履歴

`outputs/prompt-cache.jsonl`

- `key`: キャッシュキー
- `prompt`: 生成済みプロンプト本文
- `createdAt`: 生成時刻（epoch ms）
- `input`: プロンプト生成時の入力オブジェクト

`outputs/agent-trust-histories.json`

- `updatedAt`: 最終更新時刻（ISO）
- `histories`: エージェント別集計
- `histories.<agent>.accepted`: 採用回数
- `histories.<agent>.rejected`: 不採用回数

`outputs/orgs/catalog.json`

- `version`: カタログバージョン
- `updatedAt`: 最終更新時刻（ISO）
- `orgs[]`: Org エントリ配列
- `orgs[].alias`: 識別名
- `orgs[].instanceUrl`: 接続先 URL
- `orgs[].type`: 種別（production / sandbox / scratch / developer）
- `orgs[].tags`: 任意タグ
- `orgs[].notes`: 任意メモ
- `orgs[].registeredAt`: 登録時刻
- `orgs[].lastSeenAt`: 最終参照時刻
- `orgs[].metadata`: 任意メタデータ

`outputs/tool-proposals/proposal-feedback.jsonl`

- `resourceType`: 対象種別
- `name`: 対象リソース名
- `decision`: 採否結果（accepted / rejected 系）
- `topic`: 評価トピック（任意）
- `note`: 備考（任意）
- `recordedAt`: 記録時刻（ISO）

`outputs/tool-proposals/proposal-feedback-model.json`

- `updatedAt`: モデル更新時刻
- `minSamples`: 補正適用に必要な最小サンプル数
- `totals`: 全体採否集計
- `typeAdjustments`: 種別ごとの補正値
- `resources[]`: リソース別統計（acceptRate, adjustment など）

`outputs/tool-proposals/query-skill-feedback.jsonl`

- `query`: 入力クエリ
- `skill`: 紐づけ対象スキル名
- `decision`: 採否（accepted / rejected）
- `recordedAt`: 記録時刻（ISO）

`outputs/tool-proposals/query-skill-model.json`

- `modelVersion`: モデル識別子
- `updatedAt`: 最終更新時刻
- `totals`: 全体件数集計
- `skills[]`: スキル別統計
- `skills[].bias`: 受理傾向（正で採用寄り）
- `skills[].tokenWeights`: クエリ token ごとの重み

`outputs/reports/skill-rating.jsonl`

- `skill`: 評価対象スキル
- `rating`: 評価点（1-5）
- `topic`: トピック（任意）
- `note`: コメント（任意）
- `recordedAt`: 記録時刻（ISO）

`outputs/reports/skill-rating.json`

- `updatedAt`: 集計更新時刻
- `params`: 集計パラメータ（窓幅・閾値）
- `totals`: 全体件数・平均
- `skills[]`: スキル別統計（平均・トレンド・要改修フラグ）

レポート系（`outputs/reports/**`）の補足:

- `runs.jsonl` は「1 行 = 1 実行結果」で、実行時刻や実行入力と結果サマリを含みます。
- `latest.json` は直近 1 回分の詳細結果（キーはツールごとに異なる）です。
- `latest.md` は人間向けサマリです。
- `resource-dependency-graph/*.mmd` は Mermaid グラフ定義、`*.json` は同内容の構造化データです。

`outputs/state.sqlite` の補足:

- `SF_AI_HISTORY_SQLITE=true` 時に使用される SQLite 永続化先です。
- 主なテーブルは `history_sessions`, `jsonl_records`, `governance_state` です。
- `history_sessions` は `id`, `timestamp`, `topic`, `agents_json`, `entries_json` を持ちます。

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

### 調査目的別の参照順（実運用向け）

障害対応で「どこから見ればいいか」を固定化した順番です。

#### 1) 失敗の一次原因を最短で知りたい

1. `outputs/events/system-events.jsonl`（失敗イベントの種類と時刻）
2. `outputs/events/trace-log.jsonl`（失敗した traceId と errorMessage）
3. `outputs/events/metrics-samples.jsonl`（同時刻の遅延・失敗率）
4. `outputs/execution-origins.jsonl`（どの入力パス / リポジトリ起点だったか）

#### 2) オーケストレーションの詰まりを見たい

1. `outputs/sessions/<sessionId>.json`（`queue`, `firedRules`, `agentTrust`）
2. `outputs/history/YYYY-MM-DD/<id>.json`（会話履歴の実態）
3. `outputs/agent-graph.jsonl`（遷移学習の偏り有無）

#### 3) ガバナンス判定や拒否の理由を追いたい

1. `outputs/resource-governance.json`（現在の閾値・disabled 状態）
2. `outputs/operations-log.jsonl`（直近の enable/disable/create/delete）
3. `outputs/audit/tool-executions.jsonl`（実行拒否やポリシー判定）

#### 4) 提案学習・推薦精度の変化を見たい

1. `outputs/tool-proposals/proposal-feedback.jsonl`（採否の生ログ）
2. `outputs/tool-proposals/proposal-feedback-model.json`（補正値の現在値）
3. `outputs/tool-proposals/query-skill-feedback.jsonl`（query-skill 教師データ）
4. `outputs/tool-proposals/query-skill-model.json`（tokenWeights / bias の変化）

#### 5) レポート系ツールの結果だけ確認したい

1. 対象ツールの `outputs/reports/<type>/latest.md`（人間向けサマリ）
2. 同 `latest.json`（機械可読な詳細）
3. 同 `runs.jsonl`（過去実行との比較）

#### 6) 復旧優先でロールバック判断したい

1. `outputs/events/system-events.jsonl`（発生時刻の特定）
2. `outputs/backups/`（復元候補スナップショット）
3. `npm run ai -- outputs:version -- list` で候補確認
4. 必要なら `npm run ai -- outputs:version -- restore --snapshot <snapshot-id>`

## allow-list (`outputs/.schema.json`) と Lint

`outputs/` 直下に置けるディレクトリ・ファイル名は [`outputs/.schema.json`](../outputs/.schema.json) で**ホワイトリスト**として宣言されています (TASK-F12)。

- `outputs/.schema.json` が存在しない初期状態では、`lint:outputs` はトップレベル検証をスキップし、warning のみ出力します。
- `outputs/custom-tools/*.json` の DeclarativeToolSpec 検証は、`outputs/.schema.json` が無くても継続して実行されます。

- `allowedDirectories`: トップレベルのサブディレクトリ名 (`history`, `events`, `sessions`, `orgs` など)。
- `allowedFiles`: トップレベルに置けるファイル名 (`memory.jsonl`, `vector-store.jsonl`, `tool-catalog.json` など)。
- `allowedFiles` に含まれる `*.jsonl` については、`<base>.jsonl.<timestamp>.gz` 形式のアーカイブファイルも許可されます（例: `memory.jsonl.1777359892395.gz`）。
- 検査は **トップレベルの完全一致のみ**。サブツリー内のファイル構造はチェックしません。

### Lint の実行

```bash
npm run lint:outputs
```

[`scripts/lint-outputs.ts`](../scripts/lint-outputs.ts) がこのスキーマを読み込み、`outputs/` 直下に未許可エントリが存在すれば差分を報告します。
`outputs/.schema.json` が無い場合はトップレベル検証をスキップし、warning を表示します。

### 新しい永続化先を追加するとき

1. 実装側で書き込みパスを決める (例: `outputs/foo-bar/`)。
2. [`outputs/.schema.json`](../outputs/.schema.json) の `allowedDirectories` または `allowedFiles` に追記する。
3. このページの「フォルダ構成」「自動で保存されるもの／されないもの」表にも 1 行追加する。
4. `npm run lint:outputs` で差分が無いことを確認。

※ `outputs/.schema.json` を削除した状態で運用する場合、手順 2 は不要ですが、allow-list 保護は効かなくなります。
