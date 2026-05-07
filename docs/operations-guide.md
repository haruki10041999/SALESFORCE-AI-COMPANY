# 運用ガイド（非エンジニア向け）

このガイドは、開発知識がなくても日常運用できるように作っています。

## このガイドでできること

- サービスが動いているか確認する
- 異常が出たときに最低限の切り分けをする
- 必要なログとバックアップを確認する

## Docker有り運用（Postgres + Ollama + 任意の観測性）

Docker Desktop を使わない運用を行う場合は、先に [WSL2 + Docker Engine 運用手順 (Docker Desktop なし)](./wsl-docker-engine-setup.md) を参照してください。

前提:

- Docker Desktop / Docker Compose が利用可能
- ホスト版 Ollama を同時起動しない（`11434` のポート競合回避）
- Postgres を使うため `5432` のポート競合がないこと

1. 依存サービスを起動

```bash
docker compose up -d postgres ollama
docker compose ps
```

観測性も含める場合:

```bash
docker compose --profile observability up -d
docker compose ps
```

2. MCP サーバ側の `.env` を運用プロファイルで準備

```powershell
Copy-Item .env.operations.sample .env
```

バックエンド設定の確認（オプション）:

```powershell
# Postgres + pg-boss + PGVector を使う場合
# .env 内で以下を設定
SF_AI_STATE_BACKEND=postgres
SF_AI_PROPOSAL_QUEUE_BACKEND=pg-boss
SF_AI_VECTOR_BACKEND=pgvector
DATABASE_URL=postgres://sfai:sfai@localhost:5432/sfai

# または既定のまま（SQLite + file-based queue + tfidf）
# SF_AI_STATE_BACKEND=sqlite
# SF_AI_PROPOSAL_QUEUE_BACKEND=file
# SF_AI_VECTOR_BACKEND=tfidf
```

3. MCP サーバ起動

```bash
npm run ai -- dev
```

4. 疎通確認

- Ollama API: `http://localhost:11434`
- PostgreSQL: `localhost:5432`
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
バックエンド接続確認（Postgres 利用時）:

```bash
# psql で接続確認（PostgreSQL client 必須）
psql -U sfai -d sfai -h localhost -c "SELECT version();"

# pg-boss queue テーブル確認
psql -U sfai -d sfai -h localhost -c "SELECT * FROM pgboss.job LIMIT 5;"

# PGVector index 確認（VECTOR_BACKEND=pgvector 時）
psql -U sfai -d sfai -h localhost -c "SELECT COUNT(*) FROM pgboss.migration WHERE id = 'create-vector-index';"
```
5. 停止手順

```bash
docker compose down
```

重要:

- `docker compose down` は DB データを残します
- `docker compose down -v` は Postgres の named volume も削除し、DB データが消えます
- 通常運用では `down -v` を使わないでください

補足:

- Docker 構成の詳細は `ollama-setup.md` を参照
- Prometheus は `host.docker.internal:9464/metrics` を scrape する構成
- `npm run ai -- dev` は stdio 接続が切れるとプロセス終了するため、`/metrics` は MCP クライアント接続中のみ利用可能
- 複数リポジトリで同時運用する場合は `PROMETHEUS_METRICS_PORT` と `OTEL_SERVICE_NAME` を分離する
- Grafana ダッシュボード JSON は `infra/observability/grafana-dashboards/` で管理する
- LangSmith は `SF_AI_LANGSMITH_ENABLED=true` の明示指定時のみ有効

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

補足:

- Git 管理下では `npm run init` 時に `pre-commit` フックが自動導入されます
- コミット前に `lint-outputs` と staged file の secret / PII チェックが走ります
- 手動実行は `npm run guard:precommit` です

3. テスト状況を確認

```bash
npm test
```

確認ポイント:

- `fail` が 0

4. Agent trust scoring の有効化確認（運用プロファイル）

```bash
npm test -- tests/runtime-config-agent-trust.test.ts
```

確認ポイント:

- `AI_AGENT_TRUST_SCORING_ENABLED=true` を運用 `.env` で設定していること
- 互換キー `SF_AI_AGENT_TRUST_SCORING_ENABLED` / `SF_AI_AGENT_TRUST_THRESHOLD` でも動作すること
- 閾値は `0.0..1.0` の範囲外だと既定値 `0.55` にフォールバックすること

## 週次の確認（10分）

1. メトリクス確認

```bash
npm run ai -- metrics:report -- --top 10
```

学習メトリクスの自動更新（Task 8）:

```bash
# 学習ダッシュボード更新のみ
npm run metrics:update

# drift / regression 検知も同時実行
npm run metrics:update:drift
```

補足:

- `metrics:update:drift` は `--with-drift` フラグで実行され、`cross-env` は不要です（Windows/Unix 共通）。

見るポイント:

- `outputs/dashboards/learning-progress.json` が更新されること
- drift 同時実行時は Postgres に drift report が保存されること（file fallback 時は `outputs/reports/drift-regression.jsonl`）

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

- `wipe` は `backups/` を残して生成物 artifacts を整理する
- 既定では wipe 前に snapshot が 1 つ追加で作られる
- どのリポジトリ起点の実行だったかは Postgres の `execution_origins` を確認する

4. ベンチマークの記録

```bash
npm run benchmark:run -- --limit 200
```

見るポイント:

- `outputs/reports/benchmark-suite.json` が更新されること（レポート生成物）
- 前回結果と比較して有意な劣化がないこと

4. オーケストレーション学習ログの確認（F14）

確認ポイント:

- Postgres の agent graph 学習データが増加していること（fallback 時は `outputs/agent-graph.jsonl`）
- Postgres の audit logs に tool execution が記録されていること（fallback 時は `outputs/audit/tool-executions.jsonl`）
- `dequeue_next_agent` 実行結果に `graphRecommendation` が含まれることがある（学習データ依存）

4. SQLite 履歴モードを使う場合の整合チェック

前提チェック（`SF_AI_HISTORY_SQLITE=true` で運用する場合）:

```bash
# node:sqlite が利用できるか確認
node -e "require('node:sqlite'); console.log('node:sqlite OK')"
```

見るポイント:

- `node:sqlite OK` が出ること
- `npm config get ignore-scripts` が `true` でも動作する（native addon 不要）
- 実行時に `ExperimentalWarning: SQLite is an experimental feature` が出ても、動作自体は継続可能

削除ゲート（旧 SQLite / JSONL 実装の安全な撤去条件）は
`docs/observability-cleanup-playbook.md` を参照してください。

```bash
# JSONL/history -> state.sqlite
npm run state:migrate-sqlite

# state.sqlite -> JSONL 互換出力 + 元 JSONL との行数突合
npm run state:export-jsonl -- --out-dir outputs/exported-jsonl --verify-source-dir outputs
```

見るポイント:

- `verification.matched` が `true`
- 不一致時は終了コード 1（必要なら `--allow-mismatch` で出力継続）
- Windows で DB ファイルを削除・移動する前に、`npm run ai -- dev` 停止後のハンドル解放を確認する

## トラブル時の手順

1. まず `doctor` を実行

```bash
npm run ai -- doctor
```

2. ログ確認

- Postgres の `system_events`
- Postgres の `execution_origins`

3. 必要なら復元

```bash
npm run ai -- outputs:version -- list
npm run ai -- outputs:version -- restore --snapshot <snapshot-id>
```

4. 復元後に再確認

```bash
npm run ai -- doctor
```

5. SQLite 検証用 DB の整理（必要時）

- 検証で `outputs/state-dev.sqlite` など一時 DB を作成した場合、運用 DB を `state.sqlite` に統一したら不要ファイルを整理する
- 削除前に `npm run ai -- outputs:version -- backup` で snapshot を作成する

## どのファイルを見るか

- 出力全体の意味: `outputs-structure.md`
- 設定値: `configuration.md`
- 実行 provenance: Postgres `execution_origins`
- Agent graph 学習ログ: Postgres の analytics データ（fallback 時は `../outputs/agent-graph.jsonl`）
- ツール実行監査ログ: Postgres の audit logs（fallback 時は `../outputs/audit/tool-executions.jsonl`）
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
