# DR 自動化

DR drill を 1 コマンドで実行するための運用ドキュメントです。
dry-run を既定にし、実行時のみ promote / DNS / rollback の各 hook を動かします。

## 実行コマンド

```bash
npm run dr:drill -- --dry-run
```

復元とバックアップ検証:

```bash
npm run dr:restore -- --snapshot <snapshot-id> --dry-run
npm run dr:verify-backup -- --min-entries 1
```

SIEM 連携:

```bash
npm run siem:export:audit -- --provider ndjson --dry-run
npm run siem:export:audit -- --provider splunk-hec --max-retries 3 --retry-base-ms 250 --retry-max-ms 5000
npm run dr:compliance-report
npm run siem:replay-dead-letter -- --provider splunk-hec --endpoint https://example.local/hec
```

SIEM 送信に失敗したバッチは dead-letter に退避可能です:

```bash
npm run siem:export:audit -- --provider splunk-hec --continue-on-batch-error --dead-letter-path outputs/audit/siem-export.dead-letter.jsonl
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
- `SF_AI_SIEM_PROVIDER`
- `SF_AI_SIEM_ENDPOINT`
- `SF_AI_SIEM_TOKEN`
- `SF_AI_SIEM_MAX_RETRIES`
- `SF_AI_SIEM_RETRY_BASE_MS`
- `SF_AI_SIEM_RETRY_MAX_MS`

## 生成物

- report: `outputs/reports/dr-drill-latest.json`
- restore report: `outputs/reports/dr-restore-latest.json`
- backup verify report: `outputs/reports/backup-verify-latest.json`
- SIEM export report: `outputs/reports/siem-export-latest.json`
- SOC2 compliance report: `outputs/reports/compliance-soc2-latest.json`
- snapshot: `outputs/backups/`
- SIEM export cursor: `outputs/audit/siem-export.cursor.json`
- SIEM dead-letter: `outputs/audit/siem-export.dead-letter.jsonl`
- dead-letter replay report: `outputs/reports/siem-dead-letter-replay-latest.json`
- compliance markdown: `docs/compliance/soc2-dr-siem-latest.md`

## コンプライアンス拡張

- `dr:compliance-report` は SOC2 controls に加えて ISO27001 Annex A の対応表を生成する
- JSON レポートでは `iso27001Summary` を出力する

## 挙動

- 実行前に outputs snapshot を作成します
- `--execute` 時は primary / replica の probe を行います
- promote / DNS 切替が失敗した場合は rollback hook を実行します
- 結果は JSON レポートとして保存します

## 関連

- [docs/dr-failover.md](../../docs/dr-failover.md)
- [scripts/dr-drill.ts](../../scripts/dr-drill.ts)
- [docs/configuration.md](../../docs/configuration.md)
