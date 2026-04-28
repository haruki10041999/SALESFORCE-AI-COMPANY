# Salesforce AI Company

**Salesforce AI Company** は、MCP サーバーとして Salesforce 開発を支援する AI エージェント・スキル・ツールを**動的に選択・補完・拡張する**システムです。

## 📚 ドキュメント

最初に読むもの：

- **全体像**: README（このファイル）
- **Ollama Docker 運用**: [docs/ollama-setup.md](docs/ollama-setup.md) ← **環境構築はここから**
- **アーキテクチャ**: [docs/system-architecture-with-uml.md](docs/system-architecture-with-uml.md)
- **ドキュメント索引**: [docs/documentation-map.md](docs/documentation-map.md)
- **学習の仕組み**: [docs/learning-guide.md](docs/learning-guide.md)
- **OpenCode セットアップ**: [docs/opencode-setup.md](docs/opencode-setup.md)

## 🏗️ システム構成

```
MCP クライアント
    ↓ (MCP プロトコル)
mcp/server.ts
    ├─→ ツール群（113+ 個 / Code 層 + Declarative 層）
    ├─→ mcp/core/ （コアロジック）
    │   ├─ resource/ （スコアリング・ギャップ検出）
    │   ├─ quality/ （品質チェック・重複排除）
    │   ├─ governance/ （ガバナンス・日次制限）
    │   └─ event/ （EventDispatcher）
    ├─→ mcp/handlers/ （19+ レジストラー）
    │   ├─ register-*.ts
    │   ├─ auto-init.ts
    │   └─ statistics-manager.ts
    ├─→ コンテンツ層
    │   ├─ agents/ (17個)
    │   ├─ skills/ (11カテゴリ, 31+個)
    │   ├─ personas/ (15個)
    │   ├─ context/ (全プロンプトに自動注入)
    │   └─ prompt-engine/ (プロンプト構築)
    └─→ outputs/ （永続化）
        ├─ presets/
        ├─ history/
        ├─ sessions/
        ├─ custom-tools/
        ├─ resource-governance.json
        └─ events/
```

## 🚀 クイックスタート

### インストール

```bash
npm install
npm run init      # 初回のみ: outputs/ 初期化
npm run build     # TypeScript ビルド
npm run ai -- doctor    # 任意: 設定・権限の診断
```

### サーバー起動

```bash
# 開発実行
npm run mcp:dev

# ビルド済みで起動
npm run mcp:start
```

### 統一 CLI

```bash
npm run ai -- dev               # 開発起動
npm run ai -- doctor            # 診断
npm run ai -- metrics:report    # メトリクス確認
npm run ai -- observability:dashboard -- --trace-limit 200 --event-limit 1000
npm run ai -- outputs:cleanup -- --dry-run
npm run ai -- outputs:version -- backup
npm run ai -- outputs:version -- list
npm run ai -- outputs:version -- wipe --keep-backups
npm run ai -- learning:replay -- --limit 20
npm run ai -- scaffold -- agent my-agent
npm run ai -- scaffold -- skill apex/my-skill
npm run ai -- scaffold -- preset release-readiness-check --agents release-manager,qa-engineer
```

### outputs 運用の要点

- `SF_AI_OUTPUTS_DIR` を絶対パスで指定すると、どのリポジトリから使っても出力先を 1 箇所に集約できます
- `npm run ai -- outputs:cleanup -- --dry-run` は古い生成物だけを整理します
- `npm run ai -- outputs:version -- backup` は現在の `outputs/` を世代バックアップします
- `npm run ai -- outputs:version -- wipe --keep-backups` は `backups/` を残して `outputs/` を空にします
- `outputs/execution-origins.jsonl` には、どのリポジトリ起点の実行かが JSONL で追記されます
- 履歴保存を SQLite へ切り替える場合は `SF_AI_HISTORY_SQLITE=true` を指定します（実装は `sql.js` ベース）
- SQLite ファイルの保存先は `SF_AI_STATE_DB_PATH` で変更できます（既定: `outputs/state.sqlite`）
- 既定の運用 DB 名は `state.sqlite` に統一されています

### SQLite 互換データ移行

```bash
# JSONL/history -> state.sqlite
npm run state:migrate-sqlite

# state.sqlite -> JSONL 互換出力
npm run state:export-jsonl -- --out-dir outputs/exported-jsonl

# 元 JSONL 行数との整合チェック（不一致時は終了コード 1）
npm run state:export-jsonl -- --out-dir outputs/exported-jsonl --verify-source-dir outputs
```

### 学習フローの短い図

```text
フィードバック / rating / A/B結果
    ↓
outputs/tool-proposals/*.jsonl
outputs/reports/skill-rating.*
outputs/agent-trust-histories.json
    ↓
proposal-feedback model / query-skill model / trust history 更新
    ↓
search_resources / auto_select_resources / trust scoring に反映
```

## 🧪 テスト

```bash
npm test                           # 全テスト実行
npm run typecheck                  # 型チェック
npm run ai -- outputs:cleanup -- --dry-run  # 古いファイル確認
```

## 📦 リソース

### エージェント（17個）

- architect, apex-developer, lwc-developer, qa-engineer, security-engineer
- performance-engineer, integration-developer, flow-specialist, data-modeler
- devops-engineer, debug-specialist, refactor-specialist, repository-analyst
- documentation-writer, release-manager, product-manager, ceo

詳細: [docs/resource-inventory.md](docs/resource-inventory.md)

### スキル（11カテゴリ, 31+個）

- Apex, LWC, Security, Performance, Testing
- Integration, Salesforce Platform, Refactoring, Documentation, DevOps, Data Model

詳細: [docs/resource-inventory.md](docs/resource-inventory.md)

### ペルソナ（15個）

architect, engineer, hacker, doctor, detective, strategist, commander, diplomat  
historian, gardener, samurai, jedi, inventor, speed-demon, captain, archivist

詳細: [docs/resource-inventory.md](docs/resource-inventory.md)

## 🔧 環境変数

| 変数 | 説明 | デフォルト |
|---|---|---|
| `SF_AI_OUTPUTS_DIR` | outputs ディレクトリ | `./outputs` |
| `SF_AI_HISTORY_SQLITE` | 履歴ストアを SQLite に切り替える (`true`/`false`) | `false` |
| `SF_AI_STATE_DB_PATH` | SQLite ファイルパス（`SF_AI_HISTORY_SQLITE=true` 時に利用） | `outputs/state.sqlite` |
| `SF_AI_OUTPUTS_BACKUP_DIR` | outputs バックアップ保存先 | `outputs/backups` |
| `SF_AI_OUTPUTS_BACKUP_KEEP` | 保持する snapshot 世代数 | `5` |
| `OTEL_ENABLED` | OTel SDK を有効化する (`true`/`false`) | `false` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP HTTP エンドポイント | 未設定 |
| `OTEL_SERVICE_NAME` | OTel サービス名（Jaeger識別用） | `salesforce-ai-company` |
| `PROMETHEUS_METRICS_PORT` | `/metrics` 公開ポート（`0`で無効） | `0` |
| `LOG_LEVEL` | ログレベル (error/warn/info/debug) | `info` |
| `SF_AI_AUTO_APPLY` | 自動適用の有効化 | `false` |
| `SF_AI_AUTO_APPLY_MIN_SCORE` | 品質スコア下限 | `70` |
| `SF_AI_AUTO_APPLY_MAX_PER_DAY` | 1日あたりの自動生成上限 | `5` |

詳細: [docs/configuration.md](docs/configuration.md)

## 📊 主要メトリクス

テスト状況：

```bash
npm test
npm run metrics:report -- --top 10
npm run metrics:dashboard
```

詳細: [docs/metrics-evaluation.md](docs/metrics-evaluation.md)

## ✨ 主な特徴

- **高度なスコアリング**: Jaccard + 使用頻度 + バグシグナル
- **ギャップ検出**: リソース不足の自動検知
- **品質強制**: Skill/Tool/Preset の3つの品質プロファイル
- **重複排除**: Levenshtein距離ベース（threshold: 0.8）
- **イベント駆動**: 19+ ハンドラーで自動対応
- **ガバナンス**: 日次制限・キャパシティ管理
- **統計追跡**: 全アクション・エラー・パターンの可視化

## 📝 開発ガイド

- 開発者向け: [docs/developer-guide.md](docs/developer-guide.md)
- 運用担当者向け: [docs/operations-guide.md](docs/operations-guide.md)
- 技術仕様: [docs/architecture.md](docs/architecture.md)
- 学習の仕組み: [docs/learning-guide.md](docs/learning-guide.md)
- OpenCode セットアップ: [docs/opencode-setup.md](docs/opencode-setup.md)

## 🐛 トラブルシューティング

```bash
# 診断実行
npm run ai -- doctor

# ファイルシステムの健全性確認
npm run ai -- outputs:cleanup -- --dry-run

# outputs をバックアップしてから空にする
npm run ai -- outputs:version -- backup
npm run ai -- outputs:version -- wipe --keep-backups

# 必要なら snapshot から復元
npm run ai -- outputs:version -- list
npm run ai -- outputs:version -- restore --snapshot <snapshot-id>
```

詳細: [docs/verification-guide.md](docs/verification-guide.md)

## 📄 ライセンス

MIT
