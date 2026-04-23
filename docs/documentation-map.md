# ドキュメント索引

このファイルは全ドキュメントへの入口です。目的に応じて参照先を選んでください。

---

## 基本ドキュメント（最初に読む）

| ファイル | 内容 |
|---|---|
| [README.md](../README.md) | プロジェクト概要・アーキテクチャ・クイックスタート |
| [docs/configuration.md](./configuration.md) | 環境変数の全一覧とデフォルト値 |
| [verification-guide.md](../verification-guide.md) | ビルド・テスト・手動検証の手順 |

---

## 機能別ドキュメント（docs/features/）

各ツールの詳細な説明・パラメータ・出力例・推奨ワークフローはこちら。

| ファイル | 対象ツール |
|---|---|
| [01-static-analysis.md](./features/01-static-analysis.md) | `apex_analyze` / `lwc_analyze` / `flow_analyze` / `permission_set_analyze` |
| [02-repository-analysis.md](./features/02-repository-analysis.md) | `repo_analyze` |
| [03-branch-diff-pr.md](./features/03-branch-diff-pr.md) | `branch_diff_summary` / `branch_diff_to_prompt` / `pr_readiness_check` / `security_delta_scan` / `deployment_impact_summary` / `changed_tests_suggest` / `coverage_estimate` / `metadata_dependency_graph` |
| [04-deployment.md](./features/04-deployment.md) | `deploy_org` / `run_tests` / `deployment_plan_generate` |
| [05-chat-generation.md](./features/05-chat-generation.md) | `chat` / `simulate_chat` / `smart_chat` / `batch_chat` |
| [06-orchestration.md](./features/06-orchestration.md) | `orchestrate_chat` / `evaluate_triggers` / `dequeue_next_agent` / `get_orchestration_session` / `save_orchestration_session` / `restore_orchestration_session` |
| [07-logging-history.md](./features/07-logging-history.md) | `record_agent_message` / `get_agent_log` / `parse_and_record_chat` / `analyze_chat_trends` / `save_chat_history` / `load_chat_history` / `restore_chat_history` / `export_to_markdown` / `get_handlers_dashboard` |
| [08-presets-definitions.md](./features/08-presets-definitions.md) | `list_agents` / `get_agent` / `list_skills` / `get_skill` / `list_personas` / `create_preset` / `list_presets` / `run_preset` |
| [09-resource-governance.md](./features/09-resource-governance.md) | `search_resources` / `auto_select_resources` / `get_resource_governance` / `record_resource_signal` / `review_resource_governance` / `apply_resource_actions` |
| [10-event-automation.md](./features/10-event-automation.md) | `get_system_events` / `get_event_automation_config` / `update_event_automation_config` / `get_tool_execution_statistics` |
| [11-metrics-benchmarks.md](./features/11-metrics-benchmarks.md) | `metrics_summary` / `benchmark_suite` |

---

## 目的別ガイド

### 初めて起動する

1. [README.md](../README.md) — インストール・起動コマンド
2. [docs/configuration.md](./configuration.md) — 環境変数の確認

### 特定のツールの使い方を調べる

上の「機能別ドキュメント」テーブルから該当ファイルを参照してください。

### Salesforce PR をレビューする

→ [03-branch-diff-pr.md](./features/03-branch-diff-pr.md)「PR マージ可否判断フロー」

### デプロイ計画を立てる

→ [04-deployment.md](./features/04-deployment.md)「リリース前デプロイ準備フロー」

### AI エージェント間の議論を回す

→ [05-chat-generation.md](./features/05-chat-generation.md) → [06-orchestration.md](./features/06-orchestration.md)

### ツールの性能が落ちている気がする

→ [11-metrics-benchmarks.md](./features/11-metrics-benchmarks.md) → [10-event-automation.md](./features/10-event-automation.md)

### スキル・ツール・プリセットを管理する

→ [08-presets-definitions.md](./features/08-presets-definitions.md) → [09-resource-governance.md](./features/09-resource-governance.md)

### ビルドやテストの手順を確認する

→ [verification-guide.md](../verification-guide.md)

---

## クイックリファレンス

```bash
# 起動
npm run mcp:dev          # 開発モード（tsx、ホットリロードなし）
npm run mcp:start        # 本番モード（コンパイル済み dist/）

# ビルド・テスト
npm run build            # TypeScript コンパイル
npm test                 # 全テスト実行
npm run typecheck        # 型チェックのみ

# 初期化・診断
npm run init             # outputs/ ディレクトリ構造を初期化
npm run doctor           # 設定・権限・構造を診断
```