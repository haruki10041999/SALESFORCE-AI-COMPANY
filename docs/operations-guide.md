# 運用ガイド（非エンジニア向け）

このガイドは、開発知識がなくても日常運用できるように作っています。

## このガイドでできること

- サービスが動いているか確認する
- 異常が出たときに最低限の切り分けをする
- 必要なログとバックアップを確認する

## Docker有り運用（Ollama + 観測性）

前提:

- Docker Desktop / Docker Compose が利用可能
- ホスト版 Ollama を同時起動しない（`11434` のポート競合回避）

1. 依存サービスを起動

```bash
docker compose up -d
docker compose ps
```

2. MCP サーバ側の `.env` を運用プロファイルで準備

```powershell
Copy-Item .env.operations.sample .env
```

3. MCP サーバ起動

```bash
npm run ai -- dev
```

4. 疎通確認

- Ollama API: `http://localhost:11434`
- Jaeger UI: `http://localhost:16686`
- Prometheus UI: `http://localhost:9090`
- Grafana UI: `http://localhost:3000`
- Prometheus scrape target: `http://localhost:9464/metrics` (既定)

6. Telemetry 確認（任意）

```bash
# Prometheus endpoint
curl http://localhost:9464/metrics

# Jaeger services
curl http://localhost:16686/api/services
```

5. 停止手順

```bash
docker compose down
```

補足:

- Docker 構成の詳細は `ollama-setup.md` を参照
- Prometheus は `host.docker.internal:9464/metrics` を scrape する構成
- `npm run ai -- dev` は stdio 接続が切れるとプロセス終了するため、`/metrics` は MCP クライアント接続中のみ利用可能
- 複数リポジトリで同時運用する場合は `PROMETHEUS_METRICS_PORT` と `OTEL_SERVICE_NAME` を分離する

## 毎日の確認（5分）

1. 起動できるか確認

```bash
npm run ai -- dev
```

確認ポイント:

- すぐ終了しない
- 赤いエラーが連続しない

2. 健全性チェック

```bash
npm run ai -- doctor
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
npm run ai -- metrics:report -- --top 10
```

運用向けダッシュボード再生成:

```bash
npm run ai -- observability:dashboard -- --trace-limit 200 --event-limit 1000
```

見るポイント:

- エラー件数が急増していない
- 応答時間（p95）が急に悪化していない

2. 古い履歴の整理（まず確認のみ）

```bash
npm run ai -- outputs:cleanup -- --dry-run
```

問題なければ実行:

```bash
npm run ai -- outputs:cleanup -- --days 30
```

3. バックアップ作成

```bash
npm run ai -- outputs:version -- backup
npm run ai -- outputs:version -- list
npm run ai -- outputs:version -- wipe --keep-backups
```

見るポイント:

- `wipe` は `backups/` を残して `outputs/` を空にする
- 既定では wipe 前に snapshot が 1 つ追加で作られる
- どのリポジトリ起点の実行だったかは `outputs/execution-origins.jsonl` を見る

4. SQLite 履歴モードを使う場合の整合チェック

```bash
# JSONL/history -> state.sqlite
npm run state:migrate-sqlite

# state.sqlite -> JSONL 互換出力 + 元 JSONL との行数突合
npm run state:export-jsonl -- --out-dir outputs/exported-jsonl --verify-source-dir outputs
```

見るポイント:

- `verification.matched` が `true`
- 不一致時は終了コード 1（必要なら `--allow-mismatch` で出力継続）

## トラブル時の手順

1. まず `doctor` を実行

```bash
npm run ai -- doctor
```

2. ログ確認

- `outputs/events/system-events.jsonl`
- `outputs/execution-origins.jsonl`

3. 必要なら復元

```bash
npm run ai -- outputs:version -- list
npm run ai -- outputs:version -- restore --snapshot <snapshot-id>
```

4. 復元後に再確認

```bash
npm run ai -- doctor
```

5. SQL.js 検証用 DB の整理（必要時）

- 検証で `outputs/state-sqljs.sqlite` など一時 DB を作成した場合、運用 DB を `state.sqlite` に統一したら不要ファイルを整理する
- 削除前に `npm run ai -- outputs:version -- backup` で snapshot を作成する

## どのファイルを見るか

- 出力全体の意味: `outputs-structure.md`
- 設定値: `configuration.md`
- 実行 provenance: `../outputs/execution-origins.jsonl`
- 変更履歴: `CHANGELOG.md`

## 補足: 統一CLIでの代表コマンド

- `npm run ai -- dev`
- `npm run ai -- doctor`
- `npm run ai -- observability:dashboard -- --trace-limit 200`
- `npm run ai -- outputs:cleanup -- --dry-run`
- `npm run ai -- outputs:version -- backup`
- `npm run ai -- scaffold -- preset release-readiness-check --agents release-manager,qa-engineer`

## 参照

- `ollama-setup.md`（Docker 起動・障害対応の詳細）
- `outputs-structure.md`（保存と復元の詳細）
