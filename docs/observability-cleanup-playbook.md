# 観測性 / クリーンアップ運用プレイブック

## 対象範囲

このプレイブックは、Phase 7-9 における以下の運用方針を定義します。

- OpenTelemetry と LangChain トレースの責務境界
- Grafana ダッシュボードの正本管理
- 旧 HTML ダッシュボードの廃止手順
- SQLite/JSONL フォールバック経路を安全に削除するためのゲート
- ベンチマーク実行手順と成果物の保存先

## トレース方針（LangChain callback + OTel）

### 責務分離

- OTel:
  - ランタイム/サービスのトレース、DB 計装、MCP ツール実行の可視化を担う
  - SRE と本番障害調査の一次情報源とする
- LangSmith（任意）:
  - プロンプト/LLM 実行の詳細解析を担う
  - 既定では無効、明示的 opt-in の場合のみ有効化する

### ランタイム切替

- `OTEL_ENABLED=true`: NodeSDK と自動計装を有効化
- `SF_AI_LANGSMITH_ENABLED=true`: `LANGCHAIN_TRACING_V2=true` を有効化
- 既定（`SF_AI_LANGSMITH_ENABLED=false`）: LangSmith トレースを強制的に無効化

### 二重計測の制御

- LangSmith を本番運用の必須シグナルとして扱わない。
- アラート/SLO とサービス診断は OTel を利用する。
- LangSmith はデバッグ/プロンプト評価セッション時のみ利用する。

## Grafana ダッシュボード

ダッシュボード JSON は次の場所で管理します。

- `infra/observability/grafana-dashboards/`

現在のベースラインダッシュボード:

- `sfai-runtime-overview.json`

推奨インポート手順:

1. リポジトリ上の JSON を Grafana にインポートする。
2. データソース変数 `DS_PROMETHEUS` を使用中の Prometheus データソースに紐付ける。
3. ダッシュボード変更時は JSON をこのフォルダに再エクスポートし、Git で管理する。

## 旧 HTML ダッシュボード廃止手順

旧ダッシュボードの配置先:

- `outputs/dashboards/*.html`

廃止ステップ:

1. 凍結: HTML ダッシュボードへの新規機能追加を停止する。
2. 並走運用: 2 リリースサイクルの間、Grafana パネルで既存運用チェックを網羅できることを確認する。
3. ドキュメント切替: ダッシュボード参照をすべて `infra/observability/grafana-dashboards/` 配下の Grafana JSON へ向ける。
4. 生成経路の削除: 1-3 完了後に HTML ダッシュボード生成スクリプトを削除する。

## 安全な削除ゲート（SQLite / JSONL）

すべてのゲートを満たすまでは、次のフォールバックを維持します。

- SQLite 履歴フォールバック
- JSONL 互換出力および移行スクリプト

削除ゲート:

1. CI と本番の全環境で Postgres バックエンドが 30 日連続で既定運用になっていること。
2. 同期間に SQLite/JSONL フォールバックを必要とするロールバック事故が発生していないこと。
3. リリースパイプラインで `state:export-jsonl --verify-source-dir` と統合テストが成功していること。
4. 運用ドキュメントとロールバック手順が Postgres-first 前提に更新済みであること。

すべてのゲートを満たしたら、専用の cleanup PR でフォールバック実装を削除します。

## ベンチマーク手順と成果物保存先

実行コマンド:

- `npm run benchmark:run -- --limit 200`

成果物保存先:

- メインレポート: `outputs/reports/benchmark-suite.json`
- 任意スナップショット/トレンド拡張: `outputs/reports/benchmark-suite-*.json`

比較ポリシー:

- リリース前に前回 main ブランチ成果物と比較する。
- 有意な性能劣化はリリースブロッカーとして扱う。
