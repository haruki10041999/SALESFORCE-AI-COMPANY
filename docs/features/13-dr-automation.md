# DR 自動化

DR drill を 1 コマンドで実行するための運用ドキュメントです。
dry-run を既定にし、実行時のみ promote / DNS / rollback の各 hook を動かします。

## 実行コマンド

```bash
npm run dr:drill -- --dry-run
```

本実行する場合は `--execute` を付け、primary / replica の接続先と hook コマンドを指定します。

```bash
npm run dr:drill -- --execute --primary-url <primary> --replica-url <replica> --promote-command "..." --dns-command "..." --rollback-command "..."
```

## 主な環境変数

- `SF_AI_DB_URL_PRIMARY`
- `SF_AI_DB_URL_REPLICA`
- `SF_AI_DR_DRILL_EXECUTE`
- `SF_AI_DR_PROMOTE_COMMAND`
- `SF_AI_DR_DNS_COMMAND`
- `SF_AI_DR_ROLLBACK_COMMAND`

## 生成物

- report: `outputs/reports/dr-drill-latest.json`
- snapshot: `outputs/backups/`

## 挙動

- 実行前に outputs snapshot を作成します
- `--execute` 時は primary / replica の probe を行います
- promote / DNS 切替が失敗した場合は rollback hook を実行します
- 結果は JSON レポートとして保存します

## 関連

- [docs/dr-failover.md](../../docs/dr-failover.md)
- [scripts/dr-drill.ts](../../scripts/dr-drill.ts)
- [docs/configuration.md](../../docs/configuration.md)
