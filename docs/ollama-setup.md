# Ollama Docker セットアップガイド

Salesforce AI Company では、Ollama を Docker Compose で運用することを既定としています。本ガイドは環境構築から運用、トラブルシューティングまでを網羅します。

---

## システム要件

### ホスト環境
- **OS**: Windows 10/11 (Docker Desktop), macOS, Linux
- **Docker**: Docker Engine 24.0+, Docker Compose 2.20+
- **メモリ**: 16GB 推奨（GPU モデル実行時は 20GB+）
- **ディスク**: Ollama モデル用に 50GB 以上

### GPU サポート（オプション）
- **NVIDIA**: CUDA 12.2+, nvidia-docker2
- **Apple Silicon**: Metal サポート自動有効
- **CPU のみ**: サポート（低速）

---

## セットアップ手順

### 1. Docker Desktop インストール

#### Windows / macOS
```bash
# 公式サイトからダウンロード & インストール
https://www.docker.com/products/docker-desktop

# インストール後、再起動が必要な場合あり
docker --version
docker compose version
```

#### Linux
```bash
# Ubuntu/Debian
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
# ユーザーグループ反映のため再ログイン
```

### 2. ホスト版 Ollama の停止（重要）

Docker 版と ホスト版は同じポート `11434` を使用するため、**競合を避けるためホスト版を停止**してください。

#### Windows (winget インストール版)
```powershell
# Ollama サービスを停止
Stop-Service -Name "Ollama" -ErrorAction SilentlyContinue

# サービスを無効化（起動時に立ち上がらない）
Set-Service -Name "Ollama" -StartupType Disabled -ErrorAction SilentlyContinue

# 確認
Get-Service Ollama -ErrorAction SilentlyContinue
```

#### macOS
```bash
# Ollama アプリを終了
killall ollama 2>/dev/null || true

# 起動ディレクトリから削除（オプション）
rm -f ~/Library/LaunchAgents/com.ollama.ollama.plist
launchctl unload ~/Library/LaunchAgents/com.ollama.ollama.plist 2>/dev/null || true
```

#### Linux
```bash
# systemd サービス停止
sudo systemctl stop ollama
sudo systemctl disable ollama

# 確認
systemctl status ollama
```

### 3. Docker Compose 起動

```bash
cd /path/to/salesforce-ai-company

# 全サービス起動（Ollama + 観測性スタック）
docker compose up -d

# ステータス確認
docker compose ps

# ログ確認
docker compose logs -f ollama
```

**出力例:**
```
CONTAINER ID   IMAGE                    COMMAND                  NAMES
abc123def456   ollama/ollama:0.21.2     "/bin/sh -c './ollama"   sfai-ollama
xyz789uvw012   jaegertracing/jaeger:latest ...                   sfai-jaeger
...
```

### 4. モデルのプル（初回のみ）

```bash
# Ollama コンテナシェルに接続
docker exec -it sfai-ollama bash

# モデルをプル（例: llama2, mistral など）
ollama pull llama2:latest
ollama pull mistral:latest

# プル済みモデル確認
ollama list

# シェル終了
exit
```

---

## 運用ガイド

### サービス起動・停止

#### 全サービス起動
```bash
docker compose up -d
```

#### 全サービス停止
```bash
docker compose down
```

#### 特定サービスのみ起動（Ollama を Docker で起動しない場合）
```bash
# 観測性スタックのみ起動
docker compose up -d jaeger prometheus grafana
```

#### サービスログ確認
```bash
# リアルタイムログ
docker compose logs -f ollama

# 直近 100 行
docker compose logs ollama --tail 100
```

### 環境変数設定

MCP サーバ側で以下の環境変数を設定してください。

```bash
# .env ファイル例
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_TIMEOUT_MS=60000
OLLAMA_REQUIRED=false
EMBEDDING_PROVIDER=ollama
OLLAMA_EMBEDDING_MODEL=nomic-embed-text:latest

OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
PROMETHEUS_METRICS_PORT=9464
```

### エンドポイント一覧

| サービス | URL | 説明 |
|---------|-----|------|
| **Ollama API** | `http://localhost:11434` | LLM / Embedding API |
| **Jaeger UI** | `http://localhost:16686` | Trace ダッシュボード |
| **Prometheus UI** | `http://localhost:9090` | メトリクス収集 UI |
| **Grafana UI** | `http://localhost:3000` | ダッシュボード ビルダー |

**Grafana デフォルト認証**: admin / admin（初回ログイン後に変更推奨）

---

## トラブルシューティング

### ポート競合エラー

**症状:**
```
bind: address already in use
```

**原因**: ホスト版 Ollama や他のサービスがポート 11434 を使用している。

**解決手順:**
```bash
# Windows
netstat -ano | findstr :11434
# PID が表示されたら、そのプロセスを終了
taskkill /PID <PID> /F

# macOS / Linux
lsof -i :11434
kill -9 <PID>

# 再度 Docker Compose 起動
docker compose up -d
```

### Ollama コンテナが起動しない

**症状:**
```
sfai-ollama exited with code 1
```

**確認コマンド:**
```bash
docker compose logs ollama --tail 50
```

**一般的な原因:**
1. **ポート競合** → 上記「ポート競合エラー」を参照
2. **ディスク容量不足** → `docker volume ls` で容量確認、`docker system prune -a` で不要イメージ削除
3. **メモリ不足** → `docker stats` で使用量確認、他アプリ停止

### モデルロード時間が長い

**症状**: `ollama pull` や初回推論が非常に遅い

**原因**: GPU 未使用（CPU のみモード）

**確認:**
```bash
docker exec sfai-ollama ollama list
# "size" が大きい場合、GPU サポート確認
```

**GPU 有効化:**
```yaml
# docker-compose.yml の ollama セクションで
deploy:
  resources:
    reservations:
      devices:
        - driver: nvidia
          count: 1
          capabilities: [gpu]
```

その後 `docker compose up -d ollama` で再起動。

### Jaeger / Prometheus が起動しない

**症状**: UI にアクセスできない（ポート接続拒否）

**解決:**
```bash
# ネットワーク確認
docker network ls | grep sfai

# コンテナログ確認
docker compose logs jaeger prometheus

# 再起動
docker compose restart jaeger prometheus
```

### Ollama API が応答しない

**症状**: `curl http://localhost:11434/api/tags` でタイムアウト

**確認:**
```bash
# コンテナが起動しているか
docker ps | grep ollama

# Ollama ログで エラー確認
docker compose logs ollama

# ポートが開いているか（Linux/macOS）
nc -zv localhost 11434
```

---

## ホスト版 Ollama との併行運用（オプション）

**背景**: ホスト版 Ollama をバックアップ手段として保持する場合の注意点

### ポート変更による共存
```bash
# ホスト版 Ollama をポート 11435 で実行
OLLAMA_HOST=127.0.0.1:11435 ollama serve
```

`.env` で両ポートを切り替え:
```bash
# Docker 版を使用
OLLAMA_BASE_URL=http://localhost:11434

# ホスト版に切替（テスト用）
# OLLAMA_BASE_URL=http://localhost:11435
```

### 推奨事項
- **本運用**: Docker 版（11434）のみ
- **バックアップ**: ホスト版は停止状態で保持
- **テスト**: フェールオーバーテスト時のみ別ポートで起動

---

## パフォーマンスチューニング

### メモリ割り当て
```yaml
# docker-compose.yml
services:
  ollama:
    environment:
      - OLLAMA_NUM_GPU=1  # GPU スレッド数
      - OLLAMA_MAX_LOADED_MODELS=3  # メモリに保持するモデル数
      - OLLAMA_MEMORY_FRACTION=0.8  # メモリ使用率上限（80%）
```

### マウント最適化
大容量モデル用に専用ボリュームを使用:
```yaml
volumes:
  ollama-data:
    driver: local
    driver_opts:
      type: tmpfs  # メモリバックドストレージ（高速だが一時的）
      device: tmpfs
```

---

## ログローテーション

Docker ログが肥大化するのを防ぐため:
```bash
# ~/.docker/daemon.json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "100m",
    "max-file": "3"
  }
}
```

再起動後適用:
```bash
docker compose restart
```

---

## 参考リンク

- [Ollama 公式ドキュメント](https://ollama.ai)
- [Docker Compose リファレンス](https://docs.docker.com/compose/)
- [Jaeger 運用ガイド](https://www.jaegertracing.io/docs/)
- [Prometheus ドキュメント](https://prometheus.io/docs/)

---

**最終更新**: 2026-04-28  
**バージョン**: v1.0
