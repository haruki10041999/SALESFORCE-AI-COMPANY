# DR Failover Runbook (T-33)

このドキュメントは、Postgres primary 障害時に replica へ手動 failover するための最小手順です。

## 目的

- RPO を最小化しつつサービス継続を確保する
- failover 時の作業順序を固定して運用ミスを防ぐ

## 前提

- `SF_AI_DB_URL_PRIMARY` と `SF_AI_DB_URL_REPLICA` を設定済み
- replica 側が read-only で追従中であること
- `OUTPUTS_BACKEND=s3` 利用時は cross-region replication を有効化していること

## 平常時チェック

1. primary / replica の接続性を定期確認
2. replica の遅延 (`replication lag`) を監視
3. `outputs/` バックエンドが S3 の場合、replication status を監視

## HA / Leader Election (TASK-16 初回)

- 目的: 複数インスタンス起動時に periodic job の重複実行を防止
- 実装: Postgres advisory lock (`pg_try_advisory_lock`) による leader gate
- 現在の適用範囲: `governance-auto-cleanup` の起動時 schedule 同期
	- `SF_AI_METRICS_AUTO_UPDATE_ENABLED=true` 時の metrics/drift 定期実行

設定:

- `SF_AI_LEADER_ELECTION_ENABLED=true|false` (既定: true)
- `SF_AI_INSTANCE_ID=<instance-name>` (任意、ログ識別用)
- `SF_AI_METRICS_AUTO_UPDATE_ENABLED=true|false` (既定: false)
- `SF_AI_METRICS_AUTO_UPDATE_INTERVAL_MINUTES=<minutes>` (既定: 60)

運用メモ:

1. `DATABASE_URL` 未設定時は no-op で leader 扱い (ローカル単体向け)
2. follower 側は起動時 schedule 同期をスキップし、queue 実行は pg-boss 側に委譲
3. 本番では `SF_AI_INSTANCE_ID` を pod/host 名で設定し、ログ追跡を容易にする

## HA 構成ガイド (TASK-16 完了)

Postgres:

1. 本番では single instance ではなく Patroni + streaming replication を推奨
2. テンプレート: `infra/postgres/patroni.yml`
3. failover 管理は Patroni REST API または Kubernetes operator 側へ委譲する

Ollama:

1. 単一 Ollama ではなく multi-instance + HAProxy を推奨
2. HAProxy テンプレート: `infra/llm/ollama-haproxy.cfg`
3. Docker 例: `npm run docker:up:ollama-ha`
4. MCP 側は `OLLAMA_BASE_URL=http://localhost:11444` を設定する

開発/検証メモ:

1. `docker compose --profile ollama-ha up -d ollama-1 ollama-2 ollama-haproxy`
2. replica/HA 検証では leader election を有効化したまま複数 MCP instance を起動する
3. readinessProbe / livenessProbe / PodDisruptionBudget は `infra/k8s/rollouts/` 配下テンプレートを利用する

## 障害時手順

1. 影響確認:
- アプリケーションエラー率増加
- primary DB への接続失敗

2. 書き込み停止:
- mcp server を一時停止、または write path を止める

3. replica 昇格:
- 運用 DB 手順に従って replica を read-write に昇格

4. 接続切替:
- `SF_AI_DB_URL_PRIMARY` を昇格先へ更新
- 必要に応じて `SF_AI_DB_URL_REPLICA` も更新

5. サービス再開:
- mcp server を再起動
- 主要 API の read/write を確認

## 復旧後作業

1. 障害イベントを記録
2. 失効した old-primary の再同期手順を開始
3. release-notes / 監査ログに failover を反映

## 自動ドリル

手順の定期実行や事前確認には `npm run dr:drill -- --dry-run` を使います。

詳細な実行モード、必要な環境変数、生成物は [features/13-dr-automation.md](./features/13-dr-automation.md) を参照してください。

実行時は `--execute` を付けて、`SF_AI_DB_URL_PRIMARY` / `SF_AI_DB_URL_REPLICA` を有効な接続先に設定してください。

例:

- `npm run dr:drill -- --snapshot-name dr-drill-2026-05-13 --dry-run`
- `npm run dr:drill -- --execute --primary-url <primary> --replica-url <replica> --promote-command "..." --dns-command "..."`

## DR 復元とバックアップ検証 (TASK-18 初回)

- 復元: `npm run dr:restore -- --snapshot <snapshot-id> [--dry-run]`
- バックアップ検証: `npm run dr:verify-backup -- [--snapshot <snapshot-id>] [--min-entries 1]`

生成物:

- 復元レポート: `outputs/reports/dr-restore-latest.json`
- 検証レポート: `outputs/reports/backup-verify-latest.json`

運用メモ:

1. 復元時は既定で pre-restore snapshot を作成する（`--skip-pre-backup` で無効化可）
2. `--dry-run` で復元対象の確認のみ行える
3. Kubernetes では `infra/k8s/dr/backup-verify-cronjob.yaml` で定期検証を実行できる

## SIEM Forward (TASK-18 初回)

audit log を SIEM へ転送する 2 つの方法を用意:

1. アプリ側 export: `npm run siem:export:audit -- --provider ndjson|splunk-hec|datadog-http`
2. インフラ側 forward: `infra/observability/fluent-bit.conf` を利用

主な環境変数:

- `SF_AI_SIEM_PROVIDER=ndjson|splunk-hec|datadog-http`
- `SF_AI_SIEM_ENDPOINT=<https endpoint>`
- `SF_AI_SIEM_TOKEN=<api token>`
- `SF_AI_SIEM_HOST`, `SF_AI_SIEM_PORT`, `SF_AI_SIEM_URI` (Fluent Bit 用)

## SIEM Retry / Compliance Report (TASK-18 2nd increment)

- SIEM export は HTTP provider で retry/backoff を実施する
- 実行後に `outputs/reports/siem-export-latest.json` を保存する
- SOC2 マッピングレポートを自動生成できる

追加コマンド:

- `npm run siem:export:audit -- --provider splunk-hec --max-retries 3 --retry-base-ms 250 --retry-max-ms 5000`
- `npm run dr:compliance-report`

追加生成物:

- `outputs/reports/siem-export-latest.json`
- `outputs/reports/compliance-soc2-latest.json`
- `docs/compliance/soc2-dr-siem-latest.md`
- `outputs/audit/siem-export.dead-letter.jsonl`

## インシデント対応テンプレート (TASK-18 運用)

障害発生時は以下をそのまま埋めて記録する:

1. 基本情報:
- 発生時刻:
- 検知経路 (監視/通報):
- 影響範囲 (tenant / API / 機能):

2. SIEM 連携状態:
- `siem-export-latest.json` の `provider`:
- `metrics.batchesFailed`:
- `metrics.retryCount`:
- `siem-export.dead-letter.jsonl` 退避件数:
- dead-letter 再送コマンド実行有無 (`npm run siem:replay-dead-letter ...`):

3. DR 状態:
- `backup-verify-latest.json` の `ok`:
- `dr-restore-latest.json` の `snapshot`:
- 復元手順の実行有無 (dry-run / execute):

4. 暫定対処:
- 実施したコマンド:
- ロールバック実施有無:
- サービス復旧時刻:

5. 恒久対策:
- 原因分類 (構成 / 運用 / 実装):
- 再発防止策:
- 次回 drill での検証項目:

## 参考設定

- `SF_AI_DB_URL_PRIMARY`: write/read の基準 DB URL
- `SF_AI_DB_URL_REPLICA`: read 優先 DB URL
- `OUTPUTS_BACKEND=fs|s3`: 生成物の保存先
- `SF_AI_OUTPUTS_S3_BASE_URL`: S3 互換 endpoint/prefix

## K8s テンプレート

- Postgres primary/replica Service: `../infra/k8s/dr/postgres-replica-services.yaml`
- Rollout 連携例: `../infra/k8s/rollouts/canary.yaml`, `../infra/k8s/rollouts/blue-green.yaml`
- PodDisruptionBudget: `../infra/k8s/rollouts/pod-disruption-budget.yaml`

運用ポイント:

1. `postgres-replica-services.yaml` を先に適用して DNS 名を固定する
2. rollout 側は `SF_AI_DB_URL_PRIMARY` / `SF_AI_DB_URL_REPLICA` を Service 名で参照する
3. failover 時は Service selector（role=primary/replica）を切替える
