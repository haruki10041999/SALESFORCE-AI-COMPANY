# データ永続化ガイド（Postgres ベース）

本リポジトリは **Docker Postgres を唯一のデータストア** として設計されています。`outputs` フォルダは存在せず、すべてのデータは Postgres に保存されます。

## 🎯 基本方針

- **outputs フォルダなし** — すべてのデータは Postgres に保存
- **永続化管理は Docker volume** — `postgres_data` volume で自動管理
- **バージョン管理は Postgres dump** — SQL ベースで復元可能
- **ローカル開発のみ SQLite 利用可能** — `.env.local.sample` で切り替え

## 🗄️ Postgres テーブル構成

### State / Governance / History

```sql
CREATE TABLE state_records (
  id UUID PRIMARY KEY,
  type VARCHAR(50),           -- 'governance', 'history', 'session'
  data_json JSONB,            -- State/Governance/History の統一保存
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### Proposal Queue / Cleanup Schedule

```sql
-- pg-boss スキーマ（自動作成）
CREATE SCHEMA IF NOT EXISTS pgboss;

CREATE TABLE pgboss.job (
  id UUID PRIMARY KEY,
  name VARCHAR(255),          -- 'governance-auto-cleanup' など
  data JSONB,                 -- Proposal / Schedule 定義
  state VARCHAR(50),          -- created, active, completed
  cron VARCHAR(100),          -- Cleanup schedule の cron
  createdOn TIMESTAMP,
  startedOn TIMESTAMP,
  completedOn TIMESTAMP
);
```

### Vector Store（pgvector）

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE vector_records (
  id UUID PRIMARY KEY,
  text TEXT NOT NULL,
  embedding vector(768),      -- nomic-embed-text: 768次元
  tags JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 高速検索用インデックス
CREATE INDEX ON vector_records USING hnsw (embedding vector_cosine_ops);
```

### Audit & Events

```sql
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY,
  event_type VARCHAR(50),     -- tool_executed, resource_changed, etc.
  resource_type VARCHAR(50),  -- skills, tools, presets
  details JSONB,
  timestamp TIMESTAMP DEFAULT NOW()
);

CREATE TABLE system_events (
  id UUID PRIMARY KEY,
  event_name VARCHAR(100),    -- session_start, cleanup_executed, etc.
  payload JSONB,
  timestamp TIMESTAMP DEFAULT NOW()
);
```

### Reports & Analytics

```sql
CREATE TABLE reports (
  id UUID PRIMARY KEY,
  report_type VARCHAR(50),    -- benchmark, coverage-gap, etc.
  run_timestamp TIMESTAMP,
  result_json JSONB,          -- 分析結果
  result_markdown TEXT,       -- Markdown レポート
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE reports_runs (
  id UUID PRIMARY KEY,
  report_type VARCHAR(50),
  run_data JSONB,             -- 実行履歴
  created_at TIMESTAMP DEFAULT NOW()
);
```

### その他のテーブル

```sql
CREATE TABLE memory (
  id UUID PRIMARY KEY,
  text TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE learning_metrics (
  id UUID PRIMARY KEY,
  metric_type VARCHAR(50),    -- drift, regression, etc.
  data JSONB,
  timestamp TIMESTAMP DEFAULT NOW()
);

CREATE TABLE orgs (
  id UUID PRIMARY KEY,
  alias VARCHAR(255) UNIQUE,
  instance_url VARCHAR(255),
  type VARCHAR(50),           -- production, sandbox, scratch, developer
  metadata JSONB,
  registered_at TIMESTAMP DEFAULT NOW()
);
```

## 🐳 Docker での管理

### docker-compose.yml

```yaml
version: '3.8'

services:
  postgres:
    image: pgvector/pgvector:latest
    environment:
      POSTGRES_USER: sfai
      POSTGRES_DB: sfai
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U sfai"]
      interval: 10s
      timeout: 5s
      retries: 5

    # POSTGRES_PASSWORD はこの例に直書きせず、
    # Secret Manager / CI secret / ローカル未追跡 .env から渡してください。

  ollama:
    image: ollama/ollama:latest
    volumes:
      - ollama_data:/root/.ollama
    ports:
      - "11434:11434"

  # オプション: Prometheus + Grafana
  prometheus:
    image: prom/prometheus:latest
    volumes:
      - ./infra/observability/prometheus.yml:/etc/prometheus/prometheus.yml
    ports:
      - "9090:9090"

  grafana:
    image: grafana/grafana:latest
    environment:
      GF_SECURITY_ADMIN_PASSWORD: admin
    volumes:
      - ./infra/observability/grafana-dashboards:/etc/grafana/provisioning/dashboards
    ports:
      - "3000:3000"

volumes:
  postgres_data:
    driver: local
  ollama_data:
    driver: local
```

## 💾 バックアップ・リストア

### 全 DB バックアップ（圧縮）

```bash
# dumps ディレクトリ作成
mkdir -p backups/db-dumps

# Full backup
docker exec postgres pg_dump -U sfai sfai | gzip > backups/db-dumps/backup-$(date +%Y%m%d-%H%M%S).sql.gz

# バックアップ一覧
ls -lh backups/db-dumps/
```

### リストア（バックアップから復元）

```bash
# 圧縮ファイルから復元
gzip -dc backups/db-dumps/backup-20260507-100000.sql.gz | docker exec -i postgres psql -U sfai sfai

# または unzip してから
gzip -dc backups/db-dumps/backup-20260507-100000.sql.gz > backup.sql
docker exec -i postgres psql -U sfai sfai < backup.sql
```

### Docker volume スナップショット（物理バックアップ）

```bash
# volume の物理パス確認
docker volume inspect postgres_data

# スナップショット作成（停止時のみ推奨）
docker compose down
cp -r /var/lib/docker/volumes/postgres_data/_data backups/postgres-snapshot-$(date +%s)
docker compose up -d postgres
```

## 📋 開発・運用コマンド

### 初期化

```bash
# Docker コンテナ起動 + DB スキーマ自動作成
docker compose up -d postgres ollama
docker compose exec postgres psql -U sfai sfai -f init-schema.sql

# MCP サーバ起動
npm run ai -- dev
```

### 健全性チェック

```bash
# DB 接続確認
docker exec postgres psql -U sfai sfai -c "SELECT version();"

# テーブル一覧確認
docker exec postgres psql -U sfai sfai -c "\dt"

# レコード数確認
docker exec postgres psql -U sfai sfai << EOF
SELECT 
  'state_records' as table_name, COUNT(*) as count FROM state_records
UNION ALL
SELECT 'audit_logs', COUNT(*) FROM audit_logs
UNION ALL
SELECT 'system_events', COUNT(*) FROM system_events
UNION ALL
SELECT 'vector_records', COUNT(*) FROM vector_records;
EOF
```

### ローカル開発（SQLite 使用時）

```bash
# SQLite ベースのローカル設定
Copy-Item .env.local.sample .env

# SQLite ファイル作成
npm run ai -- dev

# SQLite ファイル確認
ls -lh state.sqlite
```

## ⚡ パフォーマンス・メンテナンス

### インデックス管理

```bash
# Vector 検索用インデックス確認
docker exec postgres psql -U sfai sfai -c "\d vector_records"

# インデックス統計更新
docker exec postgres psql -U sfai sfai -c "ANALYZE vector_records;"

# インデックス再構築（メンテナンス）
docker exec postgres psql -U sfai sfai -c "REINDEX TABLE vector_records;"
```

### ストレージ管理

```bash
# DB サイズ確認
docker exec postgres psql -U sfai sfai -c "\db+"

# テーブルサイズ確認
docker exec postgres psql -U sfai sfai -c "SELECT schemaname, tablename, pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) FROM pg_tables ORDER BY pg_total_relation_size DESC;"

# 古いレコード削除（例：30日以上前のイベント）
docker exec postgres psql -U sfai sfai -c "DELETE FROM system_events WHERE timestamp < NOW() - INTERVAL '30 days';"
```

### ロギング・監視

```bash
# Postgres ログ確認
docker logs postgres

# スロークエリログ確認
docker exec postgres psql -U sfai sfai -c "SELECT query, calls, mean_exec_time FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10;"
```

## 🔒 セキュリティ

### パスワード管理

```bash
# 運用環境では強力なパスワードに変更
# docker-compose.yml の Postgres パスワードは
# Secret Manager / CI secret / ローカル未追跡 .env から注入

# .env でも更新
DATABASE_URL=postgres://sfai:${POSTGRES_PASSWORD}@localhost:5432/sfai
```

### バックアップ暗号化（推奨）

```bash
# 暗号化して保存
docker exec postgres pg_dump -U sfai sfai | gzip | openssl enc -aes-256-cbc -out backup.sql.gz.enc

# 復号化してリストア
openssl enc -d -aes-256-cbc -in backup.sql.gz.enc | gzip -dc | docker exec -i postgres psql -U sfai sfai
```

## 📚 参考資料

- [Postgres 公式ドキュメント](https://www.postgresql.org/docs/)
- [pgvector 拡張](https://github.com/pgvector/pgvector)
- [pg-boss ドキュメント](https://github.com/timgit/pg-boss)
- [Docker Compose 公式](https://docs.docker.com/compose/)
