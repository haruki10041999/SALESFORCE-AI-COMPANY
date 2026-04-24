# リソース在庫一覧

このドキュメントは、プロジェクトで利用可能なエージェント、スキル、ペルソナの完全なカタログです。

## エージェント（17個）

エージェントは、各専門領域を担当する AI アシスタントです。`list_agents` / `get_agent` ツールで参照できます。

| エージェント | 役割 | 主要領域 |
|---|---|---|
| `architect` | システム設計・アーキテクチャ判断 | 全体設計、性能設計、拡張性 |
| `apex-developer` | Apex コード実装・改修 | Apex 構文、ビジネスロジック、テスト |
| `lwc-developer` | Lightning Web Components 開発 | UI/UX、データバインディング、通信 |
| `qa-engineer` | テスト戦略・品質保証 | テスト設計、カバレッジ、自動化 |
| `security-engineer` | セキュリティ検証・監査 | CRUD/FLS、sharing、脆弱性検出 |
| `performance-engineer` | 性能最適化・チューニング | Governor Limits、SOQL 効率化、リソース最適化 |
| `integration-developer` | 外部連携・API 設計 | REST/SOAP、Callout、データ同期 |
| `flow-specialist` | Flow / Process Builder | オートメーション、ビジネスプロセス |
| `data-modeler` | データモデル設計・管理 | スキーマ、リレーション、SOQL |
| `devops-engineer` | デプロイ・環境管理 | CI/CD、バージョン管理、環境構築 |
| `debug-specialist` | 不具合調査・根本原因分析 | ログ解析、再現手順、修正戦略 |
| `refactor-specialist` | リファクタリング・最適化 | コード品質改善、技術負債解消 |
| `repository-analyst` | リポジトリ分析・品質診断 | ファイル構成、依存関係、構造改善 |
| `documentation-writer` | ドキュメント作成・管理 | 仕様書、運用ガイド、メンテナンス性 |
| `release-manager` | リリース計画・検証 | リリースノート、デプロイ計画、ロールバック |
| `product-manager` | 要件定義・プロダクト判断 | 優先度付け、ユーザー視点、提案 |
| `ceo` | 全体統括・戦略判断 | 大局的判断、リソース配分、意思決定 |

**参考**: `npm run list_agents` で一覧確認可能。

---

## スキル（11カテゴリ、31+個）

スキルは、特定のトピックや技術領域に関する専門知識モジュールです。`list_skills` / `get_skill` ツールで参照できます。

### Apex スキル

| スキル | 説明 |
|---|---|
| `apex/apex-best-practices` | Apex コード規約・設計パターン |
| - | - |

### LWC スキル

| スキル | 説明 |
|---|---|
| `lwc/lwc-best-practices` | LWC 開発ベストプラクティス |
| `lwc/lwc-component-structure` | LWC コンポーネント構成 |
| `lwc/lwc-state-management` | 状態管理パターン |

### セキュリティスキル

| スキル | 説明 |
|---|---|
| `security/secure-apex` | Apex セキュリティ実装 |
| `security/crud-fls-enforcement` | CRUD/FLS チェック |
| `security/security-rules` | セキュリティ規則・監査 |
| `security/soql-injection-prevention` | SOQL インジェクション防止 |

### パフォーマンススキル

| スキル | 説明 |
|---|---|
| `performance/governor-limits` | Governor Limits と制限値 |
| `performance/soql-selectivity` | SOQL 最適化 |
| `performance/bulk-pattern` | バルク処理パターン |
| `performance/view-state` | View State 最適化 |
| `performance/performance-optimization` | 全般的なチューニング |

### テストスキル

| スキル | 説明 |
|---|---|
| `testing/apex-test` | Apex テスト実装 |
| `testing/test-data` | テストデータ管理 |

### インテグレーションスキル

| スキル | 説明 |
|---|---|
| `integration/rest-api` | REST API 設計・実装 |
| `integration/integration-patterns` | 連携パターン・アーキテクチャ |

### Salesforce プラットフォームスキル

| スキル | 説明 |
|---|---|
| `salesforce-platform/platform-features` | Salesforce 基本機能 |
| `salesforce-platform/flow-design` | Flow 設計・ベストプラクティス |

### リファクタリングスキル

| スキル | 説明 |
|---|---|
| `refactor/refactoring` | コード品質改善手法 |

### ドキュメンテーションスキル

| スキル | 説明 |
|---|---|
| `documentation/documentation` | ドキュメント作成指針 |

### DevOps / インフラスキル

| スキル | 説明 |
|---|---|
| `devops/*` | デプロイメント、環境管理 |

### データモデルスキル

| スキル | 説明 |
|---|---|
| `data-model/*` | データベース設計、スキーマ最適化 |

**参考**: `npm run list_skills` で一覧確認可能。

---

## ペルソナ（15個）

ペルソナは、思考や行動パターンのテンプレートです。`list_personas` ツールで参照できます。

| ペルソナ | 特徴 | 適用シーン |
|---|---|---|
| `architect` | 大局的思考、設計判断 | システム全体の設計検討 |
| `engineer` | 実装志向、技術詳細 | コード実装、デバッグ |
| `hacker` | 創造的問題解決、非標準的アプローチ | 既存制約を破った解決策が必要 |
| `doctor` | 診断的思考、根本原因分析 | トラブルシューティング |
| `detective` | 調査的、証拠ベース | 不具合原因特定 |
| `strategist` | 戦略的、優先度付け | 複数課題の優先度判断 |
| `commander` | 統率力、全体指揮 | 複数チームの調整 |
| `diplomat` | 調整力、利害関係者対応 | ステークホルダー管理 |
| `historian` | 履歴・背景理解 | プロジェクト歴史を踏まえた判断 |
| `gardener` | 長期成長志向、育成 | プロジェクト成長戦略 |
| `samurai` | 武人的集中、完遂意志 | 困難な目標達成 |
| `jedi` | 理想追求、最高品質志向 | 品質第一の取り組み |
| `inventor` | 創新、新機能提案 | 革新的な改善 |
| `speed-demon` | 高速実行、スプリント志向 | 短期納期での実装 |
| `captain` | 統括、チーム責任 | プロジェクト全体責任 |
| `archivist` | 知識記録、ドキュメント重視 | 資料化・ナレッジ保存 |

---

## ツール分類

プロジェクトで利用可能なツールは約 60+ 個あります。主なカテゴリ：

- **静的解析**: `apex_analyze`, `lwc_analyze`, `repo_analyze`, `apex_dependency_graph`, `permission_set_diff`, `org_metadata_diff`
- **デプロイ・テスト**: `deploy_org`, `run_tests`
- **差分・レビュー**: `branch_diff_summary`, `branch_diff_to_prompt`, `pr_readiness_check`, `security_delta_scan`, `deployment_impact_summary`, `changed_tests_suggest`
- **プロンプト生成**: `chat`, `smart_chat`, `simulate_chat`, `batch_chat`
- **オーケストレーション**: `orchestrate_chat`, `evaluate_triggers`, `dequeue_next_agent`
- **ガバナンス**: `get_resource_governance`, `apply_resource_actions`, `record_resource_signal`
- **プリセット**: `create_preset`, `run_preset`, `list_presets`
- **メモリ**: `add_memory`, `search_memory`, `list_memory`, `clear_memory`

**参考**: ツール全一覧は `docs/system-architecture-with-uml.md` の「10. ツール分類一覧」を参照してください。

---

## リソース拡張

新しいエージェント・スキル・ペルソナを追加する場合：

```bash
npm run scaffold --
npm run scaffold -- agent <name>
npm run scaffold -- skill <category>/<name>
npm run scaffold -- tool <name> --description "..." --agents architect,qa-engineer
npm run scaffold -- --non-interactive agent <name>
```

- 引数なしの `npm run scaffold --` は対話型 Wizard を開始します。
- `--non-interactive` を付けると、既存の引数指定モードで動作します。
- `tool` は `outputs/custom-tools/*.json` を生成します。

詳細は [developer-guide.md](developer-guide.md) を参照してください。

---

## 最終更新

2026-04-24

ドキュメント作成時点のファイル構成に基づいています。最新は `list_agents` / `list_skills` / `list_personas` でご確認ください。
