# MCP Server

Salesforce AI Company MCP サーバーの概要と構成です。

## ディレクトリ構成

```
mcp/
├── server.ts              MCP サーバーエントリポイント
├── bootstrap.ts           サーバー初期化ロジック
├── env-loader.ts          環境変数読み込み
├── lifecycle.ts           サーバーライフサイクル管理
├── tool-registry.ts       ツール登録・管理
├── tool-types.ts          ツール型定義
├── transport.ts           MCP プロトコル通信層
│
├── core/                  ★ コアロジック層
│   ├── governance/        リソースガバナンス・日次制限
│   ├── resource/          スコアリング・ギャップ検知
│   ├── quality/           品質チェック・重複排除
│   ├── event/             イベント駆動・EventDispatcher
│   ├── learning/          学習データ・エージェント相性
│   ├── dependency/        Apex / LWC 依存グラフ
│   ├── trace/             トレース・デバッグ情報
│   ├── context/           プロンプトキャッシュ・コンテキスト
│   ├── io/                I/O ユーティリティ（atomic-write等）
│   └── logging/           ロギング・メトリクス
│
├── handlers/              ★ ツール登録レジストラー（19+個）
│   ├── register-*.ts      各領域のツール登録
│   ├── auto-init.ts       ツール自動初期化
│   └── statistics-manager.ts  実行統計管理
│
└── tools/                 ★ ツール実装（113+個）
    ├── apex-*.ts          Apex 関連（パーサー・分析・キャッシュ）
    ├── flow-*.ts          Salesforce Flow ツール
    ├── metrics.ts         メトリクス収集
    └── ...その他多数
```

## ツール数

| カテゴリ | 数 | 主要ツール |
|---|---|---|
| **Apex** | 12+ | parse / analyze / test-coverage / dependency-graph |
| **Flow** | 8+ | condition-simulator / complexity-analyzer |
| **Metadata** | 15+ | compare-metadata / detect-dependencies |
| **Governance** | 7+ | resource-discovery / auto-disable |
| **Analytics** | 8+ | health-check / drill-down-dashboard |
| **Learning** | 6+ | skill-discovery / feature-prediction |
| **Resource** | 11+ | proposal / approval / apply |
| **その他** | 40+ | utilities / conversions / validators |
| **合計** | **113+** | |

## コアロジック層

### governance/
リソースガバナンス・日次実行制限。

```
outputs-versioning.ts     — 世代管理・ロールバック
outputs-origin.ts         — 実行履歴・トレーサビリティ
resource-governance.ts    — リソース上限・制御
```

### resource/
スコアリング・ギャップ検出・提案。

```
proposal/
  ├── queue.ts            — 提案キュー（pending/approved/rejected）
  └── applier.ts          — 提案を実ファイルに反映
scoring/
  └── score.ts            — リソース信頼度スコアリング
```

### quality/
品質ルブリック・重複排除。

```
quality-rubric.ts         — 出力品質評価
deduplication.ts          — 重複検出
```

### event/
イベント駆動アーキテクチャ。

```
event-dispatcher.ts       — イベント配信
event-types.ts            — イベント型定義
```

### learning/
学習データ・エージェント相性分析。

```
agent-synergy.ts          — エージェント選択最適化
feedback-loop.ts          — ユーザーフィードバック反映
```

## ツール登録フロー

MCP サーバー起動時の流れ：

1. `server.ts` — MCP リクエスト受信
2. `bootstrap.ts` → `auto-init.ts` — ツール自動初期化
3. `handlers/register-*.ts` — 各領域ツール登録
4. `tool-registry.ts` — レジストリに登録
5. クライアントへ利用可能ツール一覧を返却

## 開発

### ツール追加

新規ツールを追加する際：

1. `mcp/tools/` に実装（TypeScript）
2. `mcp/handlers/register-*.ts` に登録ロジック追加
3. `mcp/server.ts` で `auto-init` 経由で自動読み込み
4. `npm test` で単体テスト確認
5. `npm run ci` で統合テスト確認

### コア機能追加

新規コア機能（例：新しいガバナンス ロジック）：

1. `mcp/core/` に領域別ディレクトリ作成
2. Pure function + I/O 関数に分離
3. `tests/` で単体テスト
4. ハンドラーで ツール化して登録

## 参考

- [GitHub Copilot Chat — MCP サーバーアーキテクチャ](../docs/system-architecture-with-uml.md)
- [ツール一覧（自動生成）](../docs/resource-inventory.md)
- [ハンドラー登録パターン](../docs/developer-guide.md)

## Workflow (Phase2 POC)

Temporal ベースの durable workflow POC を使う場合は、workflow profile を起動します。

```bash
npm run docker:up:workflow
```

開発時に core 依存もまとめて起動する場合:

```bash
npm run docker:up:dev-temporal
```

上記は Temporalite (dev/test 向け) を起動します。

MCP 側の `.env` では以下を設定します。

```env
SF_AI_WORKFLOW_ENGINE=temporal
SF_AI_ALLOW_IN_PROCESS_WORKFLOW=false
SF_AI_TEMPORAL_ADDRESS=localhost:7233
SF_AI_TEMPORAL_NAMESPACE=default
SF_AI_TEMPORAL_TASK_QUEUE=sfai-orchestration
SF_AI_TEMPORAL_RUN_WORKER=true
SF_AI_TEMPORAL_WORKFLOW_RETRY_MAX_ATTEMPTS=1
SF_AI_TEMPORAL_ACTIVITY_TIMEOUT_SECONDS=60
SF_AI_TEMPORAL_ACTIVITY_RETRY_MAX_ATTEMPTS=3
SF_AI_TEMPORAL_ACTIVITY_RETRY_INITIAL_INTERVAL_MS=1000
SF_AI_TEMPORAL_ACTIVITY_RETRY_BACKOFF_COEFFICIENT=2
```

現時点の POC 実装は段階的移行モードです。in-process は test-only で、通常は `SF_AI_WORKFLOW_ENGINE=temporal` を使います。どうしてもローカルで in-process を使う場合のみ、`SF_AI_ALLOW_IN_PROCESS_WORKFLOW=true` を明示してください。
prod (`SF_AI_ENV_MODE=prod`) では Temporal 不可時の in-process fallback は無効化されています。
`SF_AI_TEMPORAL_RUN_WORKER=true` を指定すると、MCP サーバープロセス内で Temporal worker も起動します（`env.profiles/dev.overlay` 既定）。
workflow 実行は `SF_AI_TEMPORAL_WORKFLOW_RETRY_MAX_ATTEMPTS`、activity 実行は `SF_AI_TEMPORAL_ACTIVITY_*` で retry / timeout を調整できます。

実 Temporal 統合テストを回す場合は、workflow profile 起動後に `SF_AI_TEMPORAL_INTEGRATION=true` を付けて対象テストを実行します。
