# 運用ガイド（非エンジニア向け）

このガイドは、開発知識がなくても日常運用できるように作っています。

## このガイドでできること

- サービスが動いているか確認する
- 異常が出たときに最低限の切り分けをする
- 必要なログとバックアップを確認する

## 毎日の確認（5分）

1. 起動できるか確認

```bash
npm run mcp:dev
```

確認ポイント:

- すぐ終了しない
- 赤いエラーが連続しない

2. 健全性チェック

```bash
npm run doctor
```

確認ポイント:

- `doctor` が成功で終わる

3. テスト状況を確認

```bash
npm test
```

確認ポイント:

- `fail` が 0

## 週次の確認（10分）

1. メトリクス確認

```bash
npm run metrics:report -- --top 10
```

見るポイント:

- エラー件数が急増していない
- 応答時間（p95）が急に悪化していない

2. 古い履歴の整理（まず確認のみ）

```bash
npm run outputs:cleanup -- --dry-run
```

問題なければ実行:

```bash
npm run outputs:cleanup -- --days 30
```

3. バックアップ作成

```bash
npm run outputs:version -- backup
npm run outputs:version -- list
npm run outputs:version -- wipe --keep-backups
```

見るポイント:

- `wipe` は `backups/` を残して `outputs/` を空にする
- 既定では wipe 前に snapshot が 1 つ追加で作られる
- どのリポジトリ起点の実行だったかは `outputs/execution-origins.jsonl` を見る

## トラブル時の手順

1. まず `doctor` を実行

```bash
npm run doctor
```

2. ログ確認

- `outputs/events/system-events.jsonl`
- `outputs/execution-origins.jsonl`

3. 必要なら復元

```bash
npm run outputs:version -- list
npm run outputs:version -- restore --snapshot <snapshot-id>
```

4. 復元後に再確認

```bash
npm run doctor
```

## どのファイルを見るか

- 出力全体の意味: `outputs-structure.md`
- 設定値: `configuration.md`
- 実行 provenance: `../outputs/execution-origins.jsonl`
- 変更履歴: `CHANGELOG.md`
