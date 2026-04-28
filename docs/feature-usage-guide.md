# Salesforce AI Company 機能利用ガイド

## 1. このガイドの目的

このドキュメントは、MCP クライアントから呼び出す入力例をまとめた実践集です。

起動や設定などの共通手順は、次を参照してください。

- [README.md](../README.md)
- [configuration.md](./configuration.md)
- [verification-guide.md](./verification-guide.md)

---

## 2. 代表的な入力ルール

- 文字列はダブルクォートで指定
- 配列は JSON 配列で指定
- 省略可能パラメータは未指定でも動作

3. 差分系ツールの前提

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

### 3.11 run_deployment_verification

用途:
- デプロイ後スモークテスト結果から rollback/continue/monitor を判定
- 判定レポート（JSON/Markdown）を出力

入力例:

```text
run_deployment_verification:
  targetOrg: "production"
  dryRun: false
  deploymentSucceeded: true
  smokeClassNames: ["OrderServiceTest"]
  smokeResult:
    totalTests: 12
    failedTests: 3
    passedTests: 9
  failureRateThresholdPercent: 20
```

主な出力:
- decision(recommendedAction / shouldRollback)
- smokeTestCommand
- reportJsonPath / reportMarkdownPath

### 3.12 scaffold (開発補助スクリプト)

用途:
- 新規 agent / skill / preset / custom tool の雛形を生成
- 引数なし実行で対話型 Wizard を起動

実行例:

```bash
npm run ai -- scaffold --
npm run ai -- scaffold -- --non-interactive agent release-coordinator
npm run ai -- scaffold -- --non-interactive skill apex/trigger-audit --title "Trigger Audit"
npm run ai -- scaffold -- --non-interactive preset release-readiness-check --title "Release Readiness Check" --agents release-manager,qa-engineer
npm run ai -- scaffold -- --non-interactive tool release_guard --description "Release safety check" --agents release-manager,qa-engineer
```

主な出力:
- `agents/*.md`
- `skills/<category>/*.md`
- `outputs/presets/*.json`
- `outputs/custom-tools/*.json`

### 3.13 suggest_flow_test_cases

用途:
- Flow の decision rules を抽出し、未到達パスのテストケースを提案
- 条件を満たすサンプルレコードを自動生成し、シミュレーション結果を併記

入力例:

```text
suggest_flow_test_cases:
  filePath: "force-app/main/default/flows/OrderFlow.flow-meta.xml"
  coveredPaths: ["StatusDecision.ApprovedPath"]
  maxCases: 20
```

主な出力:
- uncoveredPaths
- suggestedCases(conditionTree / sampleRecord / simulation)
- reportJsonPath / reportMarkdownPath

### 3.14 recommend_permission_sets

用途:
- 実利用権限シグナル（Object / Field / Apex）から最小権限の Permission Set 候補を推奨
- 現行 Permission Set との差分も併記可能

入力例:

```text
recommend_permission_sets:
  permissionSetFiles:
    - "force-app/main/default/permissionsets/Support.permissionset-meta.xml"
    - "force-app/main/default/permissionsets/SupportAdmin.permissionset-meta.xml"
  usage:
    objects: ["Account", "Case"]
    fields: ["Account.Name", "Case.Subject"]
    apexClasses: ["CaseService"]
  objectAccessLevel: "read"
  maxRecommendations: 5
```

主な出力:
- recommendations(score / coverage / missing / excess)
- diffFromCurrent（指定時）
- reportJsonPath / reportMarkdownPath

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

### 4.9 analyze_test_coverage_gap

用途:
- 変更Apexクラス/トリガーで対応テスト不足を検出
- CIゲート判定に使える JSON/Markdown レポートを出力

入力例:

```text
analyze_test_coverage_gap:
  repoPath: "D:/Projects/mult-agent-ai/salesforce-ai-company"
  baseBranch: "main"
  workingBranch: "feature/refactor"
  reportOutputDir: "outputs/reports"
  maxItems: 200
```

主な出力:
- hasCoverageGap
- gaps
- ciGate(pass/suggestedExitCode)
- reportJsonPath / reportMarkdownPath

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
  enableTrustScoring: true
  trustThreshold: 0.6
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
  enableTrustScoring: true
  trustThreshold: 0.7
  agentFeedback: "reject"
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

### 7.4 record_reasoning_step

用途:
- trace に Think/Do/Check ステップを記録

入力例:

```text
record_reasoning_step:
  traceId: "<trace-id>"
  stage: "think"
  message: "リスクを確認する"
  agent: "architect"
```

### 7.5 get_trace_reasoning

用途:
- 推論チェーンを JSON / Markdown / Mermaid で可視化

入力例:

```text
get_trace_reasoning:
  traceId: "<trace-id>"
  format: "all"
```

### 7.6 save_chat_history / load_chat_history / restore_chat_history

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

### 7.7 analyze_chat_trends

用途:
- エージェント別の件数・平均文字数・トピックを集計

入力例:

```text
analyze_chat_trends: {}
```

### 7.8 export_to_markdown

用途:
- 現在ログまたは履歴から Markdown を生成

入力例:

```text
export_to_markdown:
  historyId: "2026-04-20-101500"
  title: "リリース準備レビュー"
```

### 7.9 get_handlers_dashboard

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

### 9.3 recommend_first_steps

用途:
- 目的に応じたエージェント/スキル/ペルソナ/関連ドキュメントを同時に推薦
- すぐ実行できる 3 ステップの初動計画を返却

入力例:

```text
recommend_first_steps:
  goal: "Apex trigger review"
  limitPerType: 3
```

### 9.4 get_resource_governance

```text
get_resource_governance: {}
```

### 9.5 record_resource_signal

```text
record_resource_signal:
  resourceType: "skills"
  name: "apex/apex-best-practices"
  signal: "used"
```

### 9.6 review_resource_governance

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

### 9.7 apply_resource_actions

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

### 9.8 suggest_cleanup_resources

用途:
- 30日以上未使用の skills / presets / custom tools を dry-run で抽出
- `outputs/reports/` に JSON / Markdown レポートを自動出力

入力例:

```text
suggest_cleanup_resources:
  daysUnused: 30
  limit: 50
  resourceTypes: ["skills", "tools", "presets"]
```

### 9.9 record_skill_rating

用途:
- スキル利用後の満足度（1〜5）を記録
- `outputs/reports/skill-rating.md` を再生成

入力例:

```text
record_skill_rating:
  ratings:
    - skill: "apex/trigger-audit"
      rating: 4
      topic: "release review"
  recentWindow: 5
  lowRatingThreshold: 3
  trendDropThreshold: 0.5
```

### 9.10 get_skill_rating_report

用途:
- 記録済みレーティングから平均評価/トレンドを再集計
- 低下傾向スキルをリファクタ候補として返却

入力例:

```text
get_skill_rating_report:
  recentWindow: 5
  lowRatingThreshold: 3
  trendDropThreshold: 0.5
  maxSkills: 50
```

### 9.11 学習させる具体例

目的別に、どの順で何を実行すると学習が進むかの最小例です。

#### 例1: 提案の採用 / 不採用を推薦に反映したい

```text
proposal_feedback_learn:
  feedback:
    - resourceType: "skills"
      name: "security/apex-sharing-review"
      decision: "accepted"
      topic: "sharing rule review"
    - resourceType: "tools"
      name: "run_tests"
      decision: "reject_unnecessary"
      topic: "quick static review"
  minSamples: 3
```

結果:

- `outputs/tool-proposals/proposal-feedback.jsonl` に生ログを追記
- `outputs/tool-proposals/proposal-feedback-model.json` を更新
- skill へのフィードバックに `topic` があれば `query-skill-feedback.jsonl` と `query-skill-model.json` も更新

#### 例2: query と skill の相性を育てたい

```text
proposal_feedback_learn:
  feedback:
    - resourceType: "skills"
      name: "apex/trigger-audit"
      decision: "accepted"
      topic: "trigger recursion bulk safety"
    - resourceType: "skills"
      name: "apex/trigger-audit"
      decision: "accepted"
      topic: "bulk trigger governor limit review"
```

結果:

- 類似 query で `apex/trigger-audit` が上がりやすくなる
- 補正は `search_resources` / `auto_select_resources` に反映される

#### 例3: 低評価スキルをあぶり出したい

```text
record_skill_rating:
  ratings:
    - skill: "documentation/release-notes"
      rating: 2
      topic: "release summary"
      note: "情報が浅かった"
    - skill: "documentation/release-notes"
      rating: 2
      topic: "release summary"
      note: "観点が不足"
  recentWindow: 5
  lowRatingThreshold: 3
  trendDropThreshold: 0.5
```

結果:

- `outputs/reports/skill-rating.jsonl` に生ログを追記
- `outputs/reports/skill-rating.json` と `skill-rating.md` を再生成
- 条件を満たすと `flaggedForRefactor` に入る

#### 例4: A/B テスト結果を agent trust に反映したい

```text
agent_ab_test:
  topic: "security review"
  agentA: "security-engineer"
  agentB: "architect"
  applyOutcomeToTrustStore: true
```

結果:

- 比較レポートを出力
- 勝者 / 敗者の結果を `outputs/agent-trust-histories.json` に反映
- 後続の trust scoring で参照される

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

## 14. 2026-04-27 追加ツール (Phase 3)

すべて MCP ツールとして公開済み。詳細スキーマは [`docs/features/tools-reference.md`](./features/tools-reference.md) を参照。

### 14.1 開発支援

- `recommend_skills_for_role` — role / topic / 最近触ったファイル拡張子から関連スキルを推薦。
- `tune_prompt_templates` — テンプレートの avgScore / successRate / tokenEfficiency から promote / retire / leader を判定。
- `score_agent_synergy` — エージェント共起行列から協調スコアを算出 (`lift × log(1+co)`)。
- `apex_changelog` — Apex 変更履歴生成。
- `refactor_suggest` — リファクタ候補抽出。

### 14.2 解析・レビュー

- `scan_security_rules` — 10 ルール (SOQL injection / hardcoded credential / innerHTML / eval / weak crypto 等) のヒューリスティック走査。
- `predict_apex_performance` — SOQL/DML in loop、深いネスト、長大メソッドなどガバナリスクをスコアリング。
- `apex_dependency_graph` (incremental 対応) — 差分のみ再計算。

### 14.3 観測・運用

- `drill_down_dashboard` — toolName / status / 期間でフィルタしたドリルダウン集計と 5 秒窓相関。
- `visualize_feedback_loop` — rejectReason 分布 / daily timeline / (topic×resource) heatmap / 上昇下降トレンド。
- `render_governance_ui` — governance ルールを HTML / Markdown でレンダリング (XSS 対策済み)。
- `evaluate_handler_schedule` — allow/deny ルールと深夜跨ぎ時間帯の判定。

### 14.4 Org 管理

- `register_org` / `remove_org` / `get_org` / `list_orgs` — Salesforce Org カタログ CRUD と要約。

### 14.5 リソース提案キュー (Phase 4)

新規 skill / tool / preset の作成提案をキュー化し、レビュー → 物理適用までを MCP ツールで完結させる。詳細は [`docs/architecture.md`](./architecture.md) §8 / [`docs/CHANGELOG.md`](./CHANGELOG.md) の "Resource Auto-Creation" 節を参照。

- `enqueue_proposal` — `outputs/tool-proposals/pending/<id>.json` にキュー。
- `list_proposals` / `get_proposal` — status / resourceType / limit でフィルタ、または ID で 1 件取得。
- `approve_proposal` — pending → approved に移動 (実適用は別途、または `apply_proposal`)。
- `reject_proposal` — pending → rejected に移動 (理由必須)。
- `apply_proposal` — pending を `applyProposal` で物理書き込みし成功時のみ approved/ へ移動 (`skills/<slug>.md` / `outputs/custom-tools/<slug>.json` / `outputs/presets/<slug>/v<n>.json`)。
- `auto_apply_pending_proposals` — `AutoCreateGate` を通過した提案だけバッチ自動適用。`dryRun` / resourceType ごとの `config` / `denyList` / `limit` に対応。**既定はすべて enabled=false** (明示 opt-in 必須)。

### 14.6 Declarative Tool Layer

ツール本体を JSON で定義する `outputs/custom-tools/*.json` (`DeclarativeToolSpec`) を起動時に動的 `govTool` 登録する。

- `compose-prompt` — agents / persona / skills を束ねたチャットプロンプトラッパ。
- `static-text` — FAQ / テンプレート用の固定テキスト返却。
- 例示: [`docs/examples/declarative-tool.compose-prompt.example.json`](./examples/declarative-tool.compose-prompt.example.json) / [`.static-text.example.json`](./examples/declarative-tool.static-text.example.json)
- `npm run lint:outputs` で `DeclarativeToolSpec` 検証 (legacy `CustomToolDefinition` 互換)。
- 詳細な分類基準は [`docs/architecture.md`](./architecture.md) §8。

---

## 15. 補足

- chat 系は最終回答そのものではなく、会話用プロンプトを返します。
- 低スコア時は low_relevance_detected が発火します。
- error_aggregate_detected と governance_threshold_exceeded は system event 記録に加えて core event にもブリッジされます。
- `get_tool_execution_statistics` の `windows` 配列で時間帯ごとの成功率を比較できます。
- リトライは `retryEnabled: false` で無効化できます（update_event_automation_config で設定）。
- カスタムツール定義（JSON）に `tags` 配列を追加すると `search_resources` / `auto_select_resources` の検索精度が向上します。
- サーバー起動ログは `LOG_LEVEL=debug` で詳細表示されます。ログは `[LEVEL][scope] message` 形式で出力されます。
- ドキュメント自動生成: `npm run docs:tools` / `npm run docs:config` / `npm run docs:manifest`。
- `analyze_repo` / `apex_dependency_graph` 系のリポジトリ走査は、`.sf` / `.sfdx` / `node_modules` / `.git` / `dist` / `build` / `coverage` などの自動生成ディレクトリを自動的にスキップします (詳細は [`mcp/core/quality/scan-exclusions.ts`](../mcp/core/quality/scan-exclusions.ts))。
