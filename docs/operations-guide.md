# 運用ガイド（非エンジニア向け）

このガイドは、開発知識がなくても日常運用できるように作っています。

## 統一 CLI (TASK-09)

運用コマンドは統一 CLI に集約されています。

- 推奨: `npm run ai -- <command>`
- 代替: `npx sf-ai <command>`

例:

```bash
npm run ai -- doctor
npm run ai -- dev
npm run ai -- evals:run -- --ci
npx sf-ai observability:dashboard -- --trace-limit 200 --event-limit 1000
```

補足:

- `scripts/*.ts` の直接実行は将来的に非推奨です
- 既存 runbook では当面 `npm run ai -- ...` と互換運用できます

tenant_id 導入後の既存データ移行が必要な場合は、専用手順の [tenant-migration-runbook.md](./tenant-migration-runbook.md) を参照してください。

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

補足:

- `.env.operations.sample` には `SF_AI_PROFILE=operations` が含まれます。
- `SF_AI_PROFILE_STRICT=true` の既定では backend は `postgres/pg-boss/pgvector` に固定されます。
- 個別 backend を混在させる必要がある検証時のみ `SF_AI_PROFILE_STRICT=false` を明示してください。

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
- DR 手順は `dr-failover.md` を参照
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
- drift alert 発生時は `outputs/learning/drift-freeze.json` が生成され、`PolicySnapshot` は `SF_AI_LEARNING_MODE=live` でも自動的に shadow 動作へ切り替わること

drift freeze の解除:

- 期限付き freeze (`SF_AI_DRIFT_FREEZE_HOURS`) の場合は有効期限後に自動解除されます
- 手動解除する場合は `outputs/learning/drift-freeze.json` を削除し、次回の `metrics:update` または MCP 再起動で反映します

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

## Blue/Green / Canary 運用 (T-32)

Kubernetes 上で段階リリースする場合は、以下のテンプレートを利用します。

- Canary: `infra/k8s/rollouts/canary.yaml`
- Blue/Green: `infra/k8s/rollouts/blue-green.yaml`
- AnalysisTemplate: `infra/k8s/rollouts/analysis-templates.yaml`

適用順序:

1. `analysis-templates.yaml` を先に apply する
2. `canary.yaml` または `blue-green.yaml` を apply する

drift 連動 rollback:

- `sf-ai-drift-guard` は `sf_ai_drift_score` を監視し、`maxDriftScore` を超過すると analysis が fail します
- Argo Rollouts は failed analysis を検知すると rollout を中断し、安定版へ rollback します
- しきい値は rollout 側の `maxDriftScore` 引数で調整します（既定 `0.15`）

推奨手順:

1. Canary 5% で開始し、drift 指標がしきい値未満であることを確認
2. 25% → 50% → 100% へ段階昇格
3. 問題がある場合は Argo Rollouts で即時 rollback

リリースノート生成:

```bash
npm run release:notes -- --base origin/main --head HEAD
```

生成先:

- `outputs/reports/release-notes.md`
```

分類別 retention ルールで確認する場合:

```bash
npm run ai -- outputs:cleanup -- --retention-policy --dry-run
```

問題なければ実行:

```bash
npm run ai -- outputs:cleanup -- --days 30
```

分類別 retention ルールで実行する場合:

```bash
npm run ai -- outputs:cleanup -- --retention-policy
```

補足:

- cleanup 実行時は既定で `outputs/audit/retention-cleanup.jsonl` に監査ログを書き込みます
- 監査ログを書き込まない検証実行は `--no-audit-log` を付与します
- 保持日数は `SF_AI_RETENTION_DAYS_PUBLIC` / `INTERNAL` / `CONFIDENTIAL` / `RESTRICTED` で調整できます

### Audit Log Cold Storage 管理（T-35）

古い audit log をコールドストレージに移送して long-term retention を実現：

**Retention tiers**:
- **HOT** (0-90日): Postgres （フルアクセス）
- **WARM** (90日-1年): Postgres （読み取り専用）  
- **COLD** (1-7年): S3 Glacier （アーカイブ、object lock WORM）

コールドストレージからの検索：

```bash
# 特定期間の audit log を検索
npx ts-node scripts/audit-cold-restore.ts --query --from-date 2023-01-01 --actor-id foo

# パーティションを warm storage に復元
npx ts-node scripts/audit-cold-restore.ts --restore --partition audit_log_202301 --dry-run
```

見るポイント:

- `outputs/audit/archival-log.jsonl` が更新されていること
- cold storage への移送の `status` が `completed` であること
- 7年の WORM 保証がコンプライアンス要件を満たすこと

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

## 例外フロー（T-24 retention 運用）

1. 誤削除が疑われる場合

- 直近の `outputs/audit/retention-cleanup.jsonl` を確認する
- `eventType=retention_cleanup` または `eventType=outputs_cleanup` の対象ファイルを特定する
- 必要に応じて `outputs:version -- restore` で復元する

2. 想定より削除件数が多い場合

- いったん `--retention-policy --dry-run` に戻して再確認する
- `SF_AI_RETENTION_DAYS_*` を一時的に延長して実行範囲を絞る
- 原因切り分け完了まで本番では `--no-audit-log` を使わず監査ログを残す

3. 監査ログ書き込み失敗時

- `outputs/audit` の書き込み権限と空き容量を確認する
- 再実行は必ず `--dry-run` で安全確認してから行う

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
