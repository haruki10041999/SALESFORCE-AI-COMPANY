# outputs フォルダ運用ガイド

このページは、`outputs` フォルダの意味を非エンジニア向けにまとめた運用説明です。

## まず理解したいこと

- `outputs` は「実行結果の保管庫」です
- アプリ本体のコードではなく、履歴・ログ・バックアップが入ります
- 困ったときの調査材料は、ほぼこのフォルダにあります

## フォルダ構成（かんたん版）

| 場所 | 何が入るか | いつ見るか |
|---|---|---|
| `outputs/history/` | チャット履歴 | 過去の会話を見返したいとき |
| `outputs/sessions/` | オーケストレーションの状態 | 実行中セッションを追いたいとき |
| `outputs/events/` | システムイベントとメトリクス | エラーや遅延を調べるとき |
| `outputs/backups/` | 世代バックアップ | 復元したいとき |
| `outputs/audit/` | 操作の監査ログ | 誰が何をしたか確認するとき |
| `outputs/tool-proposals/` | 提案学習ログ | 推薦精度の分析をするとき |
| `outputs/benchmark/` | nightly benchmark の結果 (TASK-050) | grade 推移や regress を確認するとき |
| `outputs/dashboards/` | observability ダッシュボード (TASK-044) | 横断的な健全性を可視化したいとき |
| `outputs/reports/` | 各種スクリプトのレポート出力 | benchmark 単発実行や coverage gap などを確認したいとき |

### `outputs/history/` の日別運用

- チャット履歴は `outputs/history/YYYY-MM-DD/<historyId>.json` に保存されます。
- 日次アーカイブは `npm run history:archive -- --date=YYYY-MM-DD` で実行します。
- アーカイブ実行後は次が生成されます。
	- `outputs/history/archive/YYYY-MM-DD.json`
	- `outputs/history/archive/YYYY-MM-DD-summary.md`

## 削除してよいもの・だめなもの

### 基本ルール

- 手動削除より、まず `npm run outputs:cleanup -- --dry-run` を使う
- 復元に使う可能性があるため、`outputs/backups/` は消さない

### 消してよい例

- 古い `history/` と `sessions/`（運用ルールに従う）
- 一時検証で作った不要 JSON

### 消さないほうがよい例

- `events/system-events.jsonl`
- `resource-governance.json`
- `backups/` 配下

## よく使う運用コマンド

```bash
# 構成を作り直す
npm run init

# 健全性をチェック
npm run doctor

# 古い履歴を整理（まずは確認だけ）
npm run outputs:cleanup -- --dry-run

# バックアップ作成
npm run outputs:version -- backup

# バックアップ一覧
npm run outputs:version -- list

# 復元
npm run outputs:version -- restore --snapshot <snapshot-id>
```

## 障害時の最短手順

1. `npm run doctor` を実行
2. `outputs/events/system-events.jsonl` を確認
3. 必要なら `outputs:version` で直近バックアップへ復元
4. 復元後に再度 `npm run doctor`

## 参考（詳細構成）

- `outputs/memory.jsonl`: プロジェクトメモリ
- `outputs/vector-store.jsonl`: ベクターストア
- `outputs/resource-governance.json`: ガバナンス設定
- `outputs/operations-log.jsonl`: 操作ログ
