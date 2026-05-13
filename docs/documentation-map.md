# ドキュメント索引

## まずここから

- docs 入口ページ: [README.md](./README.md)
- 全体像と起動方法: [README.md](../README.md)
- 設定キー一覧: [configuration.md](./configuration.md)

## 初級者向け（最短導線）

- 用語を先に把握する: [non-engineer-glossary.md](./non-engineer-glossary.md)
- 開発の入口を確認する: [developer-guide.md](./developer-guide.md)
- 日常運用の流れを確認する: [operations-guide.md](./operations-guide.md)
- 検証の基本手順を確認する: [verification-guide.md](./verification-guide.md)
- 出力先の見方を確認する: [outputs-structure.md](./outputs-structure.md)

## 運用者向け

- 日次/週次運用: [operations-guide.md](./operations-guide.md)
- SLO 運用基準: [sla-slo.md](./sla-slo.md)
- DR フェイルオーバー: [dr-failover.md](./dr-failover.md)
- tenant 移行手順: [tenant-migration-runbook.md](./tenant-migration-runbook.md)
- 観測性とクリーンアップ方針: [observability-cleanup-playbook.md](./observability-cleanup-playbook.md)
- 指標評価の運用基準: [metrics-evaluation.md](./metrics-evaluation.md)
- 指標定義（計算式）: [metrics-indicators-reference.md](./metrics-indicators-reference.md)

## 深掘り設計・実装向け

- 設計要約: [architecture.md](./architecture.md)
- 詳細 UML: [system-architecture-with-uml.md](./system-architecture-with-uml.md)
- プロンプト/リソース選択ロジック: [prompt-resource-logic.md](./prompt-resource-logic.md)
- 学習ロジック全体: [learning-guide.md](./learning-guide.md)
- リソース一覧: [resource-inventory.md](./resource-inventory.md)
- テスト責務マップ: [test-file-responsibility-map.md](./test-file-responsibility-map.md)
- テナントライフサイクル: [features/12-tenant-lifecycle.md](./features/12-tenant-lifecycle.md)
- DR 自動化: [features/13-dr-automation.md](./features/13-dr-automation.md)
- プラグイン開発: [plugin-development.md](./plugin-development.md)
- OpenCode セットアップ: [opencode-setup.md](./opencode-setup.md)
- Ollama セットアップ: [ollama-setup.md](./ollama-setup.md)
- WSL + Docker Engine 運用: [wsl-docker-engine-setup.md](./wsl-docker-engine-setup.md)

## 主要領域 README

- MCP サーバーアーキテクチャ: [mcp/README.md](../mcp/README.md)
- エージェント一覧: [agents/README.md](../agents/README.md)
- スキル体系: [skills/README.md](../skills/README.md)
- ペルソナ一覧: [personas/README.md](../personas/README.md)
- コンテキスト定義: [context/README.md](../context/README.md)

## 補助資料

- 変更履歴: [CHANGELOG.md](./CHANGELOG.md)
- Declarative tool 例（compose-prompt）: [examples/declarative-tool.compose-prompt.example.json](./examples/declarative-tool.compose-prompt.example.json)
- Declarative tool 例（static-text）: [examples/declarative-tool.static-text.example.json](./examples/declarative-tool.static-text.example.json)

## 機能別仕様 (docs/features)

| # | ドキュメント |
|---|---|
| 01 | [静的解析](./features/01-static-analysis.md) |
| 02 | [リポジトリ解析](./features/02-repository-analysis.md) |
| 03 | [ブランチ差分/PR](./features/03-branch-diff-pr.md) |
| 04 | [デプロイ](./features/04-deployment.md) |
| 05 | [チャット生成](./features/05-chat-generation.md) |
| 06 | [オーケストレーション](./features/06-orchestration.md) |
| 07 | [ログ/履歴](./features/07-logging-history.md) |
| 08 | [定義/プリセット](./features/08-presets-definitions.md) |
| 09 | [リソースガバナンス](./features/09-resource-governance.md) |
| 10 | [イベント自動化](./features/10-event-automation.md) |
| 11 | [メトリクス/ベンチマーク](./features/11-metrics-benchmarks.md) |

## 生成ドキュメント (docs/generated)

CLI で再生成されるドキュメントは次を参照してください。

- [generated/features/tools-reference.md](./generated/features/tools-reference.md) — ツール一覧の自動生成版
- [generated/features/dashboard-catalog.md](./generated/features/dashboard-catalog.md) — Grafana dashboard catalog の自動生成版
- [generated/error-codes.md](./generated/error-codes.md) — エラーコード表の自動生成版
- [generated/internal/tool-manifest.md](./generated/internal/tool-manifest.md) — ツール仕様の人間可読版
- [generated/internal/tool-manifest.json](./generated/internal/tool-manifest.json) — ツール仕様の機械可読版

## 手書きドキュメント運用 (docs/handwritten)

- [handwritten/README.md](./handwritten/README.md) — docs Source-of-Truth の運用ポリシー

補足:

- 既存の `docs/*.md` は段階移行期間中の互換配置です
- 新規手書きドキュメントは `docs/handwritten/` を優先してください
