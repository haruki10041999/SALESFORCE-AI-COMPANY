# Salesforce AI Company 機能利用ガイド

## 1. このガイドの目的

このドキュメントは README とは別に、各機能の実行方法と使用例をまとめた実践ガイドです。
MCP クライアントからそのまま呼べる入力例を中心に記載しています。

関連ドキュメント:
- README: 全体像とクイックスタート
- docs/configuration.md: 環境変数一覧
- verification-guide.md: 検証手順

---

## 2. 使い始める前の前提

1. サーバー起動

```bash
npm install
npm run init   # 初回のみ: outputs/ ディレクトリ構造と governance-state.json を生成
npm run doctor # 設定/権限/outputs 構造を診断
npm run build
npm run mcp:dev
```

2. 環境変数（任意）

| 変数名 | デフォルト | 説明 |
|---|---|---|
| `SF_AI_OUTPUTS_DIR` | `<root>/outputs` | outputs/ ディレクトリの場所を変更 |
| `LOG_LEVEL` | `info` | ログ粒度: `error` / `warn` / `info` / `debug` |
| `SF_AI_AUTO_APPLY` | `false` | resource / threshold handler の自動適用を有効化 |
| `SF_AI_TRACE_FILE` | `<root>/outputs/events/trace-log.jsonl` | trace 履歴の永続化先 |
| `SF_AI_METRICS_FILE` | `<root>/outputs/events/metrics-samples.jsonl` | metrics サンプルの永続化先 |

```bash
SF_AI_OUTPUTS_DIR=/data/sf-ai/outputs LOG_LEVEL=debug npm run mcp:dev
```

3. 代表的な入力ルール

- 文字列はダブルクォートで指定
- 配列は JSON 配列で指定
- 省略可能パラメータは未指定でも動作

4. 差分系ツールの前提

- repoPath は Git 管理されたディレクトリ
- baseBranch と workingBranch は有効な参照名

---

## 3. 解析・実行補助

### 3.1 repo_analyze

用途:
- Salesforce リポジトリ内の Apex, LWC, オブジェクト系ファイルを棚卸し

入力例:

```text
repo_analyze:
  path: "D:/Projects/mult-agent-ai/salesforce-ai-company"
```

期待される出力:
- apex, lwc, objects などのファイル一覧

### 3.2 apex_analyze

用途:
- Apex ファイルの簡易静的チェック

入力例:

```text
apex_analyze:
  filePath: "force-app/main/default/classes/AccountService.cls"
```

### 3.3 lwc_analyze

用途:
- LWC JavaScript ファイルの簡易静的チェック
- renderedCallback 重処理・イベントリスナー cleanup 漏れ・unsafe innerHTML も検出

入力例:

```text
lwc_analyze:
  filePath: "force-app/main/default/lwc/accountCard/accountCard.js"
```

### 3.4 deploy_org

用途:
- Salesforce デプロイコマンド生成

入力例:

```text
deploy_org:
  targetOrg: "devhub"
  dryRun: true
```

### 3.5 run_tests

用途:
- Apex テスト実行コマンド生成

入力例:

```text
run_tests:
  targetOrg: "devhub"
```

### 3.6 flow_analyze

用途:
- Flow メタデータのノード構成とリスクヒントを確認

入力例:

```text
flow_analyze:
  filePath: "force-app/main/default/flows/OrderFlow.flow-meta.xml"
```

### 3.7 permission_set_analyze

用途:
- Permission Set の権限粒度と過剰付与リスクを確認

入力例:

```text
permission_set_analyze:
  filePath: "force-app/main/default/permissionsets/Admin.permissionset-meta.xml"
```

### 3.8 metrics_summary

用途:
- 直近のツール実行トレースから成功率・遅延を集計

入力例:

```text
metrics_summary:
  limit: 200
```

主な出力:
- activeCount
- completedCount
- successRate / errorRate
- averageDurationMs / p95DurationMs
- slowest (遅い呼び出し上位)

### 3.9 deployment_plan_generate

用途:
- ブランチ差分からデプロイ計画（リスク・順序・チェック項目）を生成

入力例:

```text
deployment_plan_generate:
  repoPath: "D:/Projects/mult-agent-ai/salesforce-ai-company"
  baseBranch: "main"
  workingBranch: "feature/refactor"
  targetOrg: "devhub"
```

主な出力:
- riskLevel
- recommendedOrder
- preChecks / postChecks
- rollbackHints

### 3.10 benchmark_suite

用途:
- 直近メトリクスを元に簡易ベンチマーク評価を実行

入力例:

```text
benchmark_suite:
  recentTraceLimit: 300
  scenarios: ["Apex review", "LWC optimization", "Release readiness"]
```

主な出力:
- overallScore
- grade (A/B/C/D)
- metricsSnapshot
- recommendations

---

## 4. ブランチ差分レビュー系

### 4.1 branch_diff_summary

用途:
- ブランチ差分の件数・内訳・変更ファイル情報を取得

入力例:

```text
branch_diff_summary:
  repoPath: "D:/Projects/mult-agent-ai/salesforce-ai-company"
  baseBranch: "main"
  workingBranch: "feature/refactor"
  maxFiles: 30
```

### 4.2 branch_diff_to_prompt

用途:
- 差分レビュー用の会話プロンプトを生成

入力例:

```text
branch_diff_to_prompt:
  repoPath: "D:/Projects/mult-agent-ai/salesforce-ai-company"
  baseBranch: "main"
  workingBranch: "feature/refactor"
  topic: "リリース前レビュー"
  turns: 8
  maxHighlights: 10
```

### 4.3 pr_readiness_check

用途:
- PR の準備度をスコア化し、ready 判定を返す

入力例（基本）:

```text
pr_readiness_check:
  repoPath: "D:/Projects/mult-agent-ai/salesforce-ai-company"
  baseBranch: "main"
  workingBranch: "feature/refactor"
```

入力例（多言語レビューコメント付き）:

```text
pr_readiness_check:
  repoPath: "D:/Projects/mult-agent-ai/salesforce-ai-company"
  baseBranch: "main"
  workingBranch: "feature/refactor"
  reviewText: "LGTM. 問題なしで承認します"
```

入力例（CI 連携フォーマット）:

```text
pr_readiness_check:
  repoPath: "D:/Projects/mult-agent-ai/salesforce-ai-company"
  baseBranch: "main"
  workingBranch: "feature/refactor"
  format: "sarif"   # json / junit / sarif
```

`reviewText` には EN / JP / ES / FR / DE / ZH / KO のレビューキーワードが認識されます。
優先順位: blocked > needsReview > ready。

主な出力:
- score
- gate: ready / needs-review / blocked
- baseGate: スコアのみに基づくゲート
- reviewSignal: `{ decision, matchedKeywords }` または null
- checklist
- recommendedAgents

### 4.4 security_delta_scan

用途:
- 差分追加行からセキュリティ懸念を検出

入力例:

```text
security_delta_scan:
  repoPath: "D:/Projects/mult-agent-ai/salesforce-ai-company"
  baseBranch: "main"
  workingBranch: "feature/refactor"
  maxFindings: 50
```

### 4.5 deployment_impact_summary

用途:
- デプロイ影響をメタデータ種別で集計

入力例:

```text
deployment_impact_summary:
  repoPath: "D:/Projects/mult-agent-ai/salesforce-ai-company"
  baseBranch: "main"
  workingBranch: "feature/refactor"
```

### 4.6 changed_tests_suggest

用途:
- 変更差分に対する推奨テストクラスを提案

入力例:

```text
changed_tests_suggest:
  repoPath: "D:/Projects/mult-agent-ai/salesforce-ai-company"
  baseBranch: "main"
  workingBranch: "feature/refactor"
  targetOrg: "devhub"
```

主な出力:
- suggestions
- runCommand

### 4.7 coverage_estimate

用途:
- 変更ソースに対する推定テスト対応（高/中/低）を返す

入力例:

```text
coverage_estimate:
  repoPath: "D:/Projects/mult-agent-ai/salesforce-ai-company"
  baseBranch: "main"
  workingBranch: "feature/refactor"
  targetOrg: "devhub"
```

主な出力:
- mappings（ソースごとの候補テストと confidence）
- overallCoverageHint
- recommendedTests
- runCommand

### 4.8 metadata_dependency_graph

用途:
- 変更/削除された CustomObject・CustomField の参照先を抽出

入力例:

```text
metadata_dependency_graph:
  repoPath: "D:/Projects/mult-agent-ai/salesforce-ai-company"
  baseBranch: "main"
  workingBranch: "feature/refactor"
  maxReferences: 50
```

主な出力:
- targets（メタデータ単位の参照一覧と risk）
- summary

---

## 5. 会話生成系

### 5.1 chat

用途:
- 標準の会話プロンプトを生成

入力例:

```text
chat:
  topic: "Apex トリガー最適化"
  agents: ["architect", "qa-engineer"]
  skills: ["apex/apex-best-practices"]
  turns: 4
  appendInstruction: "バルク化と再帰防止を必ず評価してください"
```

### 5.2 simulate_chat

用途:
- chat の互換エイリアス

入力例:

```text
simulate_chat:
  topic: "LWC パフォーマンス改善"
  turns: 3
```

### 5.3 smart_chat

用途:
- リポジトリ分析から関連ファイルを自動検出してプロンプト生成

入力例:

```text
smart_chat:
  topic: "権限設計レビュー"
  repoPath: "D:/Projects/mult-agent-ai/salesforce-ai-company"
  appendInstruction: "権限過剰付与リスクを重点確認"
```

### 5.4 batch_chat

用途:
- 複数トピックを連続でプロンプト化

入力例:

```text
batch_chat:
  topics: ["Apex レビュー", "LWC レビュー", "権限レビュー"]
  agents: ["architect", "qa-engineer"]
  appendInstruction: "各トピックでテスト観点を1つ以上提示"
```

---

## 6. オーケストレーション系

### 6.1 orchestrate_chat

用途:
- 疑似セッション開始と初期キュー生成

入力例:

```text
orchestrate_chat:
  topic: "リリース準備レビュー"
  agents: ["product-manager", "architect", "qa-engineer"]
  turns: 6
  triggerRules:
    - whenAgent: "architect"
      thenAgent: "qa-engineer"
      messageIncludes: "テスト"
      reason: "設計議論後に品質確認"
      once: true
```

### 6.2 evaluate_triggers

用途:
- 直前発言に対して triggerRules を評価

入力例:

```text
evaluate_triggers:
  sessionId: "orch-2026-04-20T10-00-00-000Z"
  lastAgent: "architect"
  lastMessage: "追加テストが必要です"
  fallbackRoundRobin: true
```

### 6.3 dequeue_next_agent

用途:
- キューから次の担当エージェントを取り出し

入力例:

```text
dequeue_next_agent:
  sessionId: "orch-2026-04-20T10-00-00-000Z"
  limit: 2
```

### 6.4 get_orchestration_session

用途:
- セッション状態確認

入力例:

```text
get_orchestration_session:
  sessionId: "orch-2026-04-20T10-00-00-000Z"
```

### 6.5 save_orchestration_session

用途:
- セッション状態を outputs/sessions に保存

入力例:

```text
save_orchestration_session:
  sessionId: "orch-2026-04-20T10-00-00-000Z"
```

### 6.6 restore_orchestration_session

用途:
- 保存済みセッションをメモリへ復元

入力例:

```text
restore_orchestration_session:
  sessionId: "orch-2026-04-20T10-00-00-000Z"
```

---

## 7. ログ・履歴

### 7.1 record_agent_message

用途:
- 単発メッセージ記録

入力例:

```text
record_agent_message:
  agent: "architect"
  message: "設計案を更新しました"
  topic: "release-review"
```

### 7.2 parse_and_record_chat

用途:
- まとめテキストを一括でログ化

入力例:

```text
parse_and_record_chat:
  topic: "release-review"
  chatText: "**architect**: 設計修正します\n**qa-engineer**: 回帰テスト追加します"
```

### 7.3 get_agent_log

用途:
- ログ参照

入力例:

```text
get_agent_log:
  agent: "architect"
  limit: 20
```

### 7.4 save_chat_history / load_chat_history / restore_chat_history

用途:
- 会話履歴の保存・一覧・復元

入力例:

```text
save_chat_history:
  topic: "release-review"
```

```text
load_chat_history: {}
```

```text
restore_chat_history:
  id: "2026-04-20-101500"
```

### 7.5 analyze_chat_trends

用途:
- エージェント別の件数・平均文字数・トピックを集計

入力例:

```text
analyze_chat_trends: {}
```

### 7.6 export_to_markdown

用途:
- 現在ログまたは履歴から Markdown を生成

入力例:

```text
export_to_markdown:
  historyId: "2026-04-20-101500"
  title: "リリース準備レビュー"
```

### 7.7 get_handlers_dashboard

用途:
- ハンドラー稼働統計を取得

入力例:

```text
get_handlers_dashboard: {}
```

---

## 8. プリセット・定義取得

### 8.1 定義系

```text
list_agents: {}
get_agent:
  name: "architect"
list_skills: {}
get_skill:
  name: "apex/apex-best-practices"
list_personas: {}
```

### 8.2 プリセット系

```text
create_preset:
  name: "Salesforce 開発レビュー"
  description: "実装レビュー用"
  topic: "実装レビュー"
  agents: ["architect", "qa-engineer"]
  skills: ["apex/apex-best-practices"]
```

```text
list_presets: {}
```

```text
run_preset:
  name: "Salesforce 開発レビュー"
  overrideTopic: "Apex セキュリティ観点レビュー"
  appendInstruction: "SOQL in loop と sharing を重点確認"
```

---

## 9. リソース検索・ガバナンス

### 9.1 search_resources

用途:
- skills/tools/presets の横断検索
- カスタムツールの `tags` フィールドも検索スコアに影響します

入力例:

```text
search_resources:
  query: "security review"
  types: ["skills", "tools", "presets"]
  limitPerType: 5
```

### 9.2 auto_select_resources

用途:
- トピックに対する最適候補を自動選択
- カスタムツールの `tags` フィールドがマッチ精度を向上させます

入力例:

```text
auto_select_resources:
  topic: "Salesforce セキュリティレビュー"
  limitPerType: 3
```

### 9.3 get_resource_governance

```text
get_resource_governance: {}
```

### 9.4 record_resource_signal

```text
record_resource_signal:
  resourceType: "skills"
  name: "apex/apex-best-practices"
  signal: "used"
```

### 9.5 review_resource_governance

```text
review_resource_governance:
  updateMaxCounts:
    skills: 150
    tools: 150
    presets: 150
  updateThresholds:
    minUsageToKeep: 2
    bugSignalToFlag: 2
```

### 9.6 apply_resource_actions

用途:
- create/delete/disable/enable を一括適用
- 実行ログを `outputs/audit/resource-actions.jsonl` に追記

入力例:

```text
apply_resource_actions:
  actions:
    - resourceType: "skills"
      action: "create"
      name: "security/apex-sharing-review"
      content: "# Apex Sharing Review\n\nCheck without sharing and CRUD/FLS."
    - resourceType: "tools"
      action: "disable"
      name: "run_tests"
```

---

## 10. イベント・自動化

### 10.1 get_system_events

```text
get_system_events:
  limit: 20
```

### 10.2 get_event_automation_config

```text
get_event_automation_config: {}
```

### 10.3 update_event_automation_config

基本設定の変更例:

```text
update_event_automation_config:
  enabled: true
  protectedTools: ["apply_resource_actions", "get_system_events"]
  rules:
    errorAggregateDetected:
      autoDisableTool: true
    governanceThresholdExceeded:
      autoDisableRecommendedTools: false
      maxToolsPerRun: 3
```

リトライ戦略の変更例:

```text
update_event_automation_config:
  retryStrategy:
    retryEnabled: true
    maxRetries: 3
    baseDelayMs: 200
    maxDelayMs: 4000
    retryablePatterns: ["timeout", "timed out", "econnreset"]
    retryableCodes: ["ETIMEDOUT", "ECONNRESET", "429", "503", "504"]
```

`retryableCodes` には HTTP ステータスコード（文字列として）または Node.js ライブラリエラーコードを指定できます。

---

### 10.4 get_tool_execution_statistics

用途:
- ツール実行イベントから成功率・失敗率・無効化ツール数を集計
- 時系列タイムラインが表示される（1h/24h/7d など複数ウィンドウ対応）

入力例（シンプル）:

```text
get_tool_execution_statistics: {}
```

入力例（時系列分析）:

```text
get_tool_execution_statistics:
  windowsMinutes: [60, 1440, 10080]
  bucketMinutes: 30
  limit: 2000
```

主な出力:
- `totals`: `{ total, success, failure, blockedByDisable }`
- `rates`: `{ successRate, failureRate }` (%)
- `disabledTools`: `{ count, names[] }`
- `perTool`: ツール別内訳
- `windows[]`: 各ウィンドウ（`windowMinutes`, `sampledEvents`, `totals`, `rates`）
- `timeline[]`: 時系列バケット（`bucketStart` ISO8601, `bucketMinutes`, `totals`, `rates`）

入力制約:
- `windowMinutes`: 1～10080（デフォルト: 60）
- `windowsMinutes`: 配列最大10件
- `bucketMinutes`: 5～180（デフォルト: 60）
- `limit`: 10～2000（デフォルト: 1000）

---

## 11. 依存ライブラリ脆弱性チェック CI

`.github/workflows/dependency-audit.yml` により、以下のタイミングで脆弱性チェックが自動実行されます。

トリガー:
- PR 作成・更新時
- `main` ブランチへの push 時
- 毎週月曜日 02:00 UTC（定期実行）
- `workflow_dispatch`（手動トリガー）

処理ステップ:
1. `npm ci` でクリーンインストール
2. `npm audit --audit-level=moderate --json` を実行
3. 集計結果を GitHub Step Summary に出力
4. 結果 JSON をアーティファクト `audit-results` としてアップロード
5. moderate 以上の脆弱性が存在する場合はジョブを失敗させる

手動でチェックする場合:

```bash
npm audit --audit-level=moderate
```

---

## 12. テストデータ生成

現在、テストデータ自動生成の組み込みツールは提供していません。

---

## 13. よくある運用パターン

### パターン A: 実装レビューを最短で回す

1. branch_diff_summary
2. pr_readiness_check
3. security_delta_scan
4. branch_diff_to_prompt
5. orchestrate_chat

### パターン B: リソースのメンテナンス

1. get_resource_governance
2. review_resource_governance
3. apply_resource_actions
4. get_handlers_dashboard

### パターン C: 長期セッションの中断再開

1. orchestrate_chat
2. evaluate_triggers / dequeue_next_agent を繰り返し
3. save_orchestration_session
4. restore_orchestration_session

### パターン D: ツール実行統計の確認とリトライ調整

1. get_tool_execution_statistics（現在の成功率・失敘率を確認）
2. update_event_automation_config（retryStrategy を必要に応じて調整）
3. get_system_events（リトライスケジュールイベントを確認）
4. get_tool_execution_statistics（windowsMinutes で時系列分析）

### パターン E: PR マージ決定フロー（多言語対応）

1. pr_readiness_check（reviewText にレビュモコメントを渡す）
2. security_delta_scan
3. deployment_impact_summary

---

## 14. 補足

- chat 系は最終回答そのものではなく、会話用プロンプトを返します。
- 低スコア時は low_relevance_detected が発火します。
- error_aggregate_detected と governance_threshold_exceeded は system event 記録に加えて core event にもブリッジされます。
- `get_tool_execution_statistics` の `windows` 配列で時間帯ごとの成功率を比較できます。
- リトライは `retryEnabled: false` で無効化できます（update_event_automation_config で設定）。
- カスタムツール定義（JSON）に `tags` 配列を追加すると `search_resources` / `auto_select_resources` の検索精度が向上します。
- サーバー起動ログは `LOG_LEVEL=debug` で詳細表示されます。ログは `[LEVEL][scope] message` 形式で出力されます。
