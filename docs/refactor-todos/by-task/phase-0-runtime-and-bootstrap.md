# Phase 0: Runtime / Bootstrap TODO

## ゴール

Docker 必須前提をコード・設定・ドキュメントに反映し、MCP 起動の共通ブートストラップを整える。

## ToDo

- [ ] Docker 必須方針を [README.md](../../README.md) に明記する
- [ ] [docker-compose.yml](../../docker-compose.yml) に `postgres` と profile 設計を反映する
- [ ] `postgres` のデータを named volume に保持する構成を入れる
- [ ] `docker compose down -v` が DB を消すことを運用手順に明記する
- [ ] `infra/postgres/init/01-extensions.sql` を追加する
- [ ] `.env.local.sample` に `DATABASE_URL` など DB 接続値を追加する
- [ ] [scripts/start-mcp-with-docker.mjs](../../scripts/start-mcp-with-docker.mjs) を基準の起動ラッパーにする
- [ ] [docs/opencode-setup.md](../../docs/opencode-setup.md) に OpenCode / VS Code 両対応手順を揃える
- [ ] [docs/examples/opencode-mcp.with-docker.example.json](../../docs/examples/opencode-mcp.with-docker.example.json) を実環境パスに合わせて見直す
- [ ] [docs/examples/vscode-mcp.with-docker.example.json](../../docs/examples/vscode-mcp.with-docker.example.json) を `.vscode/mcp.json` に反映するか判断する
- [ ] `npm run ai -- doctor` に Docker / Postgres / Ollama の接続確認を追加する

## 完了条件

- [ ] Docker が起動していない場合に早い段階で検知できる
- [ ] MCP クライアント設定から Docker 依存サービス付きで起動できる
- [ ] Postgres コンテナを再作成しても named volume が残る限り DB データが保持される
- [ ] 手順書が OpenCode / VS Code の両方で矛盾しない
