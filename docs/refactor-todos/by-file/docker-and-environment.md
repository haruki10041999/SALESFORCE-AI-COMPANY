# By File: Docker / Environment

## 対象ファイル

- [docker-compose.yml](../../docker-compose.yml)
- [.env.local.sample](../../.env.local.sample)
- [scripts/start-mcp-with-docker.mjs](../../scripts/start-mcp-with-docker.mjs)
- [scripts/init-config.js](../../scripts/init-config.js)
- [mcp/env-loader.ts](../../mcp/env-loader.ts)

## ToDo

- [x] `postgres` サービスと healthcheck を追加する
- [x] `postgres` のデータディレクトリを named volume にマウントする
- [x] `down -v` を破壊操作として README / 運用手順へ反映する
- [x] `observability` profile を compose に反映する
- [x] DB / Ollama / metrics 関連 env を `.env.local.sample` に揃える
- [x] 起動ラッパーの待機ロジックを compose 構成と一致させる
- [x] `init-config` の生成物を新 runtime 方針に追従させる
