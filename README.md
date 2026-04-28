# Salesforce AI Company

**Salesforce AI Company** は、Salesforce 開発支援用の MCP サーバーです。ローカルのコード・メタデータ・運用ログをもとに、分析ツール、会話オーケストレーション、可視化、運用補助をまとめて提供します。

## 5分セットアップ

```bash
npm ci
npm run init
npm run build
npm run ai -- doctor
```

`npm run init` で次を自動実行します。

- `outputs/` 配下の初期ディレクトリ作成
- `.env` 未作成時に `.env.local.sample` から雛形をコピー
- OpenCode 用 MCP 設定例を `outputs/setup/opencode-mcp.local.json` に生成
- Git 管理下なら `pre-commit` フックを自動導入

## 最初の1コマンド

```bash
npm run ai -- doctor
```

これで設定不足や依存関係の問題を先に確認できます。続けてよく使う導線は次です。

```bash
npm run ai -- dev
npm run ai -- observability:dashboard -- --trace-limit 200 --event-limit 1000
npm run ai -- outputs:cleanup -- --dry-run
```

## 最初に見るファイル

### 🚀 クイックスタート・セットアップ
- ローカルセットアップ: [docs/opencode-setup.md](docs/opencode-setup.md)
- 運用コマンド: [docs/operations-guide.md](docs/operations-guide.md)
- コマンド一覧: `npm run help`

### 📚 主要領域

次の 5 つは各領域の入口です。まずこれらを目を通すことを推奨します。

- **[mcp/README.md](mcp/README.md)** — MCP サーバーアーキテクチャ・ツール構成
- **[agents/README.md](agents/README.md)** — 17個のエージェント（役割別 AI）一覧
- **[skills/README.md](skills/README.md)** — 13カテゴリのスキル（知識体系）
- **[personas/README.md](personas/README.md)** — 15個のペルソナ（応答スタイル）
- **[context/README.md](context/README.md)** — プロンプト構築・コンテキスト注入

### 📖 詳細ドキュメント
- 設定項目: [docs/configuration.md](docs/configuration.md)
- 全体像: [docs/system-architecture-with-uml.md](docs/system-architecture-with-uml.md)
- 詳細索引: [docs/documentation-map.md](docs/documentation-map.md)
- 削除したスクリプト: [docs/deprecated-scripts.md](docs/deprecated-scripts.md)

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

### 初回セットアップ

```bash
npm ci
npm run init
npm run build
npm run ai -- doctor
```

補足:

- `.env` をローカル向け安全設定で始めたい場合、そのまま `npm run init` で十分です
- OpenCode 連携時は `outputs/setup/opencode-mcp.local.json` を OpenCode 設定へ貼り付けます
- `dist/mcp/server.js` は `npm run build` 後に生成されます

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
- 履歴保存を SQLite へ切り替える場合は `SF_AI_HISTORY_SQLITE=true` を指定します（実装は `node:sqlite` ベース）
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
npm run guard:precommit            # コミット前ガードを手動実行
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
