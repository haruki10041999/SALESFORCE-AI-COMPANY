# outputs 配下のファイル構成

このドキュメントは、実行時に生成される outputs 配下の構成と用途を整理したものです。

## ディレクトリ構成

- outputs/
  - audit/
  - custom-tools/
  - events/
  - history/
  - presets/
  - sessions/
  - tool-proposals/
  - memory.jsonl
  - vector-store.jsonl
  - resource-governance.json
  - operations-log.jsonl

## 各ディレクトリの役割

### outputs/audit/

- 監査ログを保存します。
- 代表例: resource-actions.jsonl

### outputs/custom-tools/

- 動的に追加されたカスタムツール定義を保存します。
- 代表例: tool-name.json

### outputs/events/

- イベントと観測情報を保存します。
- 代表例:
  - system-events.jsonl
  - trace-log.jsonl
  - metrics-samples.jsonl

### outputs/history/

- チャット履歴の保存先です。
- 代表例: history-YYYY-MM-DDTHH-mm-ss-SSSZ.json

### outputs/presets/

- プリセット定義の保存先です。
- 代表例: salesforce-dev-review.json

### outputs/sessions/

- オーケストレーションセッション保存先です。
- 代表例: orch-YYYY-MM-DDTHH-mm-ss-SSSZ.json

### outputs/tool-proposals/

- 将来拡張用のツール提案ファイル保存先です。

## ルートファイルの役割

### outputs/memory.jsonl

- プロジェクトメモリの永続化ファイルです。

### outputs/vector-store.jsonl

- ベクターストアの永続化ファイルです。

### outputs/resource-governance.json

- ガバナンス設定・使用状況・無効化状態を保持します。

### outputs/operations-log.jsonl

- リソース操作ログです。
- 日次作成・削除制限の判定に利用されます。

## 運用ルール

- 空ディレクトリでも削除しない対象:
  - custom-tools
  - tool-proposals
  - history
  - sessions
  - events
  - audit
  - presets
- 削除対象にしやすいもの:
  - 実運用で参照しないサンプル出力ファイル
  - 一時検証用に手作業で置いた JSON
- 構成再生成:
  - npm run init
- 健全性チェック:
  - npm run doctor
- メトリクス要約:
  - npm run metrics:report
- メトリクス可視化HTML生成:
  - npm run metrics:dashboard
  - 出力先: outputs/reports/metrics-dashboard.html
- 履歴クリーンアップ:
  - npm run outputs:cleanup
  - npm run outputs:cleanup -- --days 14
  - npm run outputs:cleanup -- --dry-run

## 可視化確認の動線

1. データ生成
  - MCP サーバを起動し、いくつかツールを実行して metrics を蓄積
2. 要約確認
  - npm run metrics:report -- --top 10
3. ダッシュボード生成
  - npm run metrics:dashboard
4. ブラウザ確認
  - outputs/reports/metrics-dashboard.html を開いて確認
5. 運用時チェック
  - success rate 低下、p95 増加、error 増加のツールを優先調査

## GitHub での公開と定期更新

- ワークフロー: `.github/workflows/metrics-dashboard-publish.yml`
- 公開先: GitHub Pages（workflow summary に URL を出力）
- 実行トリガー:
  - main への push（可視化関連ファイル更新時）
  - 毎日 01:00 UTC の定期実行
  - 手動実行 (`workflow_dispatch`)

ローカル確認だけでなく、GitHub 上の同一 URL で継続監視できます。

## 保持期間の推奨値

- history: 30日（監査要件がある場合は延長）
- sessions: 30日（運用トラブル調査が長期化する場合は 60 日）

`outputs:cleanup` は `outputs/history` と `outputs/sessions` のファイルを対象に、
更新日が指定日数より古いファイルを削除します。
