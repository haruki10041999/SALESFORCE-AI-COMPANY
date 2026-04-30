# salesforce-ai-company MCP サーバー — システム評価レポート

## 概要

Salesforce 開発業務を支援するマルチエージェント MCP (Model Context Protocol) サーバー。
TypeScript + Node.js で構築され、Apex / LWC / Flow / Permission Set の静的・差分解析、
マルチエージェント chat / orchestration、ガバナンス制御、強化学習によるリソース最適化など、
多層にわたる機能群を提供する。

改修案の詳細仕様は [mcp-server-improvement-spec.md](./mcp-server-improvement-spec.md) を参照。

### 主要コンポーネント

| レイヤ | 役割 |
|---|---|
| `mcp/server.ts` | エントリポイント・ツール登録のコンポジション |
| `mcp/handlers/` | カテゴリ別ツール登録・イベント連携・統計集計 |
| `mcp/tools/` | ユースケース単位の業務ロジック |
| `mcp/core/` | 品質検証・リソース選択・ガバナンス・学習・可観測性 |
| `prompt-engine/` | プロンプト組み立て・推論戦略選択・評価 |
| `agents/`, `skills/`, `personas/` | 知識定義群 (Markdown) |
| `memory/` | JSONL 永続化 + LRU ベクトルストア |
| `outputs/` | イベント・履歴・セッション・ガバナンス状態の永続化先 |

---

## 強み

### 1. 多層アーキテクチャによる責務分離
- Entry → Handler → Tool → Core の明確な 4 レイヤ構成
- `layer-manifest` と Lint スクリプトで依存方向が強制される
- 変更の影響範囲が小さく、テスト・保守が容易

### 2. リソース自動選択の多段階スコアリング
- `nameMatch + tagMatch + descriptionMatch + usageScore - bugPenalty + recencyBonus` の 6 要素スコア
- リソース種別ごとに重みが異なる（skills / tools / presets 各設定）
- n-gram コサイン類似度による embedding hybrid モードも実装済み（TASK-042）
- QueryIntentClassifier で 7 種類の intent を分類してスコア設定を動的調整

### 3. 強化学習によるフィードバックループ
- Thompson sampling (Beta 分布 bandit) による探索/活用バランス制御
- Proposal feedback + skill rating + trace 完了を統合して arm を更新
- `forcedExplorationRate` でコールドリソースへの強制探索も可能

### 4. ガバナンス・自動化基盤の充実
- 上限・しきい値管理、disable 状態管理を一元化
- `governance-event-automation` でイベント駆動の自動アクション定義
- `handler-schedule` で時間帯別の allow/deny 制御

### 5. 可観測性の高さ
- `trace` モジュールで input/plan/execute/render フェーズを計測
- Prometheus メトリクス出力、HTML/Markdown/JSON の多形式ダッシュボード
- drill-down フィルタ + 5 秒窓相関分析

### 6. 多言語エラーハンドリング
- `core/errors/i18n/` ロケール辞書と errorCode テーブルで国際化済み

---

## 弱み

### 1. server.ts の肥大化
- インポート行が 80 行超、ツール登録ロジックと初期化ロジックが混在
- ファイルの全体像を把握するコストが高い

### 2. embedding モードがデフォルト off
- `embeddingMode: "off"` が既定値で、n-gram hybrid の恩恵を受けるには明示的な設定変更が必要
- 精度向上機能が実質的に未活用

### 3. バンディットモデルのインメモリ管理
- `BanditState` は `Map<string, BanditArm>` のみでサーバー再起動時に状態リセット
- 永続化の仕組みが `outputs/` との統合まで未完（学習が蓄積されない）

### 4. QueryIntentClassifier のキーワードマッチ依存
- キーワード辞書による頻度カウントのみで分類するため、曖昧なクエリや複合意図への対応が弱い
- 例：「設計レビュー」→ design か review か分散して confidence が落ちる

### 5. context-budget の重みがハードコード
- `DEFAULT_CATEGORY_WEIGHTS` (agent 0.30, skill 0.25 等) がコード埋め込み
- ユースケースや組織によって最適値が異なるが設定から変更不可

### 6. ガバナンス状態が SQLite + JSONL の二重管理
- `state.sqlite-wal/shm` と `*.jsonl` が並存しており、データ整合性の保証が複雑

### 7. テストカバレッジの偏り
- `tests/` の範囲が core 層中心で、handlers 層の統合テストが薄い可能性がある

---

## 修正すべき点

### P1（高優先度）

| # | 問題 | 修正方針 |
|---|---|---|
| R1 | バンディット状態の非永続化 | `BanditState` を `outputs/` の JSONL に永続化し、起動時にロード |
| R2 | `embeddingMode` デフォルトを `"hybrid"` に変更 | `DEFAULT_SCORING_CONFIG` の `embeddingMode` を `"hybrid"` に設定 |
| R3 | `server.ts` の責務過多 | ツール登録コードを `tool-registry.ts` に移管し、server.ts は bootstrap に専念 |

### P2（中優先度）

| # | 問題 | 修正方針 |
|---|---|---|
| R4 | context-budget 重みを設定可能に | 環境変数または `context/` の設定ファイルから上書きできるようにする |
| R5 | SQLite と JSONL の二重管理を統一 | governance 状態は SQLite 一本化し、JSONL は audit log 専用にする |
| R6 | QueryIntentClassifier のスコア分散問題 | 複合 intent 検出時にトップ 2 を保持して "multi-intent" 判定を追加 |

### P3（低優先度）

| # | 問題 | 修正方針 |
|---|---|---|
| R7 | handlers 層の統合テスト不足 | `tests/handlers/` ディレクトリを追加し主要ハンドラーのシナリオテストを作成 |
| R8 | エラーコードの文書化 | `core/errors/messages.ts` のコード一覧をドキュメントとして自動生成 |

---

## 追加したら良い機能

### F1. リアルタイムフィードバック UI
- ツール実行後に「役に立ちましたか？」の 1-5 スターを返すスキーマを標準化
- Claude Desktop / VS Code 側で inline evaluation ウィジェットを実装

### F2. Multi-intent ルーティング
- 「設計 + 実装 + レビュー」のような複合クエリを受け取り、自動でエージェント分割してオーケストレーション開始

### F3. コンテキスト予算のトークン計測精度向上
- 現在は文字数ベース（`maxContextChars`）。tiktoken 相当のトークナイザーを統合してモデル別の実際のトークン消費を管理

### F4. バンディット状態のダッシュボード統合
- `outputs/dashboards/` に bandit arm の成功率・試行回数を可視化するパネルを追加

### F5. Org 横断メタデータ差分の timeline 保存
- 複数 SF Org 間でメタデータを比較する `compare_org_metadata` の結果を timeline 形式で保存・可視化

### F6. 依存グラフの変更影響シミュレーション
- `metadata_dependency_graph` の結果を使い、ファイル変更時の影響範囲をスコア付きで予測

### F7. LLM モデル切り替えのホットリロード
- `model-registry` の shadow/promote を利用し、実行中のサーバーを停止せずモデルを切り替えるエンドポイントを追加

### F8. セキュリティスキャン自動スケジュール
- `scan_security_rules` を cron 相当のタイマーで定期実行し、変更差分のあるファイルのみ再スキャン
