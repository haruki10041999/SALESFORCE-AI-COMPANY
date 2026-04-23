# アーキテクチャ概要

このドキュメントは、本リポジトリの設計を短時間で把握するための導線です。
詳細な UML 図は `system-architecture-with-uml.md` を参照してください。

## 1. システムの目的

Salesforce 開発業務を対象に、MCP サーバとして次の機能を提供します。

- 解析: Apex / LWC / Flow / Permission Set などの静的・差分解析
- 計画: デプロイ計画、テスト推定、PR レビュー支援
- 対話: 複数エージェントによる chat / orchestrate
- 運用: ガバナンス制御、イベント自動化、メトリクス集計

## 2. レイヤ構成

### Entry / Composition

- `mcp/server.ts`
  - MCP サーバのエントリポイント
  - 各 register モジュールを呼び出してツール登録

### Handler Layer

- `mcp/handlers/`
  - `register-*.ts` がツール群をカテゴリ単位で登録
  - イベント連携、オート初期化、統計集計を担当

### Tool Layer

- `mcp/tools/`
  - ユースケース単位の業務ロジック
  - 入出力検証、Git 呼び出し、Salesforce コマンド連携など

### Core Layer

- `mcp/core/`
  - `quality/`: zod を使った検証
  - `resource/`: リソース選択・提案・スコアリング
  - `governance/`: しきい値、上限、disable 状態管理
  - `event/`: イベント発火と履歴管理
  - `trace/`: トレース文脈管理
  - `logging/`: ログ出力制御

### Knowledge Layer

- `agents/`, `skills/`, `personas/`, `context/`
  - プロンプト生成時に参照する定義群
- `prompt-engine/`
  - プロンプト組み立て、評価、レビュー補助

### Persistence Layer

- `outputs/`
  - events / history / sessions / presets / governance 状態
- `memory/`
  - `project-memory.ts`, `vector-store.ts`
  - JSONL 永続化 + LRU ベースのレコード管理

## 3. 代表的な処理フロー

### Smart Chat

1. `smart_chat` が topic から関連ファイル・リソース候補を抽出
2. prompt-engine がコンテキストを統合してプロンプト生成
3. エージェント構成で応答を作成
4. 必要に応じてログ・履歴へ記録

### Resource Governance

1. リソース変更要求を受け付け
2. 品質チェックと重複チェックを実施
3. ガバナンス上限を評価
4. 変更反映とイベント発火
5. 統計・履歴を `outputs/` へ保存

### Orchestration

1. セッションを作成してキューを初期化
2. `dequeue_next_agent` で担当エージェントを順次取得
3. `evaluate_triggers` でルール評価
4. 履歴とセッション状態を更新

## 4. 非機能観点

- 安全性
  - 入力検証を共通化し、危険なパスや識別子を遮断
- 観測性
  - trace と metrics を JSONL へ継続記録
- 拡張性
  - register モジュール分割で機能追加しやすい構造
- 運用性
  - `npm run ci` で typecheck + test + dependency audit を一括実行

## 5. 参照順序

1. `README.md`（概要と起動）
2. `docs/documentation-map.md`（索引）
3. `docs/features/`（機能別）
4. `system-architecture-with-uml.md`（詳細 UML）
