# Refactor TODOs

リファクタリング作業を、次の 2 つの切り口で追えるように整理した ToDo 集です。

- `by-task/`: Phase / 作業単位で進めるための ToDo
- `by-file/`: 影響ファイル群ごとに進めるための ToDo

## 使い分け

- 実装順で進めるとき: `by-task/`
- 変更影響を追いながら進めるとき: `by-file/`
- PR を小さく切るとき: `by-task/` の 1 ファイル = 1 PR の叩き台
- レビュー観点を整理するとき: `by-file/`

## 一覧

### by-task

- [phase-0-runtime-and-bootstrap.md](by-task/phase-0-runtime-and-bootstrap.md)
- [phase-1-postgres-and-drizzle.md](by-task/phase-1-postgres-and-drizzle.md)
- [phase-2-3-llm-and-vector.md](by-task/phase-2-3-llm-and-vector.md)
- [phase-4-5-orchestration-and-queue.md](by-task/phase-4-5-orchestration-and-queue.md)
- [phase-6-platform-libraries.md](by-task/phase-6-platform-libraries.md)
- [phase-7-9-observability-cleanup-docs.md](by-task/phase-7-9-observability-cleanup-docs.md)

### by-file

- [runtime-and-client-config.md](by-file/runtime-and-client-config.md)
- [docker-and-environment.md](by-file/docker-and-environment.md)
- [persistence-and-db.md](by-file/persistence-and-db.md)
- [llm-and-vector.md](by-file/llm-and-vector.md)
- [orchestration-and-history.md](by-file/orchestration-and-history.md)
- [proposal-and-scheduler.md](by-file/proposal-and-scheduler.md)
- [platform-utilities-and-cli.md](by-file/platform-utilities-and-cli.md)
- [observability-and-docs.md](by-file/observability-and-docs.md)

## 前提

- Docker 必須
- MCP の外部契約は壊さない
- まず共有基盤を差し替え、ツール固有ロジックは極力維持する
