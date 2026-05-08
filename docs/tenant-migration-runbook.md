# Tenant 移行 Runbook

この Runbook は、既存データに tenant_id を付与して multi-tenant 運用へ移行するための実運用手順です。

## 対象

- orchestration_sessions
- orchestration_steps
- memory_records
- tool_executions
- audit_log

## 事前確認

1. メンテナンス時間を確保する
2. バックアップを取得する
3. 付与する tenant_id を決める

推奨: まず dry-run を実行し、更新件数を確認してから本実行する。

## バックアップ

### Postgres

```bash
docker exec postgres pg_dump -U sfai sfai | gzip > backups/db-dumps/pre-tenant-migration-$(date +%Y%m%d-%H%M%S).sql.gz
```

### SQLite

```powershell
Copy-Item outputs/state.sqlite "backups/state-pre-tenant-migration-$(Get-Date -Format yyyyMMdd-HHmmss).sqlite"
```

補足: SQLite のパスを変更している場合は SF_AI_STATE_DB_PATH の実ファイルをバックアップする。

## 実行手順

### 1) dry-run

```bash
npm run ai -- migrate:tenant-scope -- --tenant tenant-a --dry-run
```

### 2) 本実行

```bash
npm run ai -- migrate:tenant-scope -- --tenant tenant-a
```

### 3) テーブルを限定して実行する場合

```bash
npm run ai -- migrate:tenant-scope -- --tenant tenant-a --tables orchestration_sessions,orchestration_steps
```

### 4) backend を明示する場合

```bash
# SQLite
npm run ai -- migrate:tenant-scope -- --tenant tenant-a --backend sqlite --db-path outputs/state.sqlite

# Postgres
npm run ai -- migrate:tenant-scope -- --tenant tenant-a --backend postgres --database-url postgres://sfai:sfai@localhost:5432/sfai
```

## 検証手順

### A. NULL tenant の残件確認

#### Postgres

```sql
SELECT 'orchestration_sessions' AS table_name, COUNT(*) AS null_tenant_count FROM orchestration_sessions WHERE tenant_id IS NULL
UNION ALL
SELECT 'orchestration_steps', COUNT(*) FROM orchestration_steps WHERE tenant_id IS NULL
UNION ALL
SELECT 'memory_records', COUNT(*) FROM memory_records WHERE tenant_id IS NULL
UNION ALL
SELECT 'tool_executions', COUNT(*) FROM tool_executions WHERE tenant_id IS NULL
UNION ALL
SELECT 'audit_log', COUNT(*) FROM audit_log WHERE tenant_id IS NULL;
```

#### SQLite

```sql
SELECT 'orchestration_sessions' AS table_name, COUNT(*) AS null_tenant_count FROM orchestration_sessions WHERE tenant_id IS NULL;
SELECT 'orchestration_steps' AS table_name, COUNT(*) AS null_tenant_count FROM orchestration_steps WHERE tenant_id IS NULL;
```

### B. tenant 境界の動作確認

1. tenant-a でオーケストレーション session を作成する
2. tenant-b で list_orchestration_sessions を実行する
3. tenant-a の session が見えないことを確認する
4. tenant-b で restore_orchestration_session を実行し、not found になることを確認する

## ロールバック

### Postgres

```bash
gzip -dc backups/db-dumps/pre-tenant-migration-YYYYMMDD-HHMMSS.sql.gz | docker exec -i postgres psql -U sfai sfai
```

### SQLite

```powershell
Copy-Item backups/state-pre-tenant-migration-YYYYMMDD-HHMMSS.sqlite outputs/state.sqlite -Force
```

## 障害時の切り分け

- migrate:tenant-scope で table not found が出る:
  - そのテーブルは未使用か未作成。必要なら対象テーブルを --tables で絞る。
- Postgres 接続失敗:
  - DATABASE_URL を確認する。
- SQLite ファイル見つからず:
  - SF_AI_STATE_DB_PATH または --db-path を確認する。

## 関連

- operations-guide.md
- data-persistence-guide.md
- scripts/migrate-tenant-scope.ts
