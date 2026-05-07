# Phase 7-9: Observability / Cleanup / Docs TODO

## ゴール

観測性を標準化し、旧実装を整理し、ドキュメントと CI を新構成へ揃える。

## ToDo

- [ ] `@opentelemetry/auto-instrumentations-node`, `@opentelemetry/instrumentation-pg` を導入する
- [ ] LangChain callback と OTel の接続方針を定める
- [ ] Grafana ダッシュボード JSON を `infra/observability/grafana-dashboards/` に追加する
- [ ] 自作 HTML ダッシュボード群の撤去手順を決める
- [ ] `langsmith` を任意機能として切替可能にする
- [ ] 旧 SQLite / JSONL 実装の削除条件を定義する
- [ ] [README.md](../../README.md), [docs/configuration.md](../../docs/configuration.md), [docs/operations-guide.md](../../docs/operations-guide.md) を更新する
- [ ] CI 定義に Postgres サービスを追加する
- [ ] ベンチマーク手順と比較結果の保存先を決める

## 完了条件

- [ ] トレース / メトリクス / ログの責務分離ができている
- [ ] 旧実装を safely remove できる状態になっている
- [ ] ドキュメントだけ読めば新規参加者が起動できる
