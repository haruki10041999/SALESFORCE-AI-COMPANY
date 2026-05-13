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

## 参考設定

- `SF_AI_DB_URL_PRIMARY`: write/read の基準 DB URL
- `SF_AI_DB_URL_REPLICA`: read 優先 DB URL
- `OUTPUTS_BACKEND=fs|s3`: 生成物の保存先
- `SF_AI_OUTPUTS_S3_BASE_URL`: S3 互換 endpoint/prefix

## K8s テンプレート

- Postgres primary/replica Service: `../infra/k8s/dr/postgres-replica-services.yaml`
- Rollout 連携例: `../infra/k8s/rollouts/canary.yaml`, `../infra/k8s/rollouts/blue-green.yaml`

運用ポイント:

1. `postgres-replica-services.yaml` を先に適用して DNS 名を固定する
2. rollout 側は `SF_AI_DB_URL_PRIMARY` / `SF_AI_DB_URL_REPLICA` を Service 名で参照する
3. failover 時は Service selector（role=primary/replica）を切替える
