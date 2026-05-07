# Phase 6: Platform Libraries TODO

## ゴール

差別化要素ではない自作ユーティリティを OSS に置き換え、保守コストを下げる。

## ToDo

- [ ] `pino`, `pino-pretty` 導入と logger の薄いラッパ化
- [ ] `dotenv` 導入と env-loader の簡素化
- [ ] `commander` 導入と `scripts/ai.ts` の再編
- [ ] `write-file-atomic` 導入と atomic write の統一
- [ ] `gray-matter` + `yaml` に frontmatter パースを寄せる
- [ ] `simple-git` に Git 実行を寄せる
- [ ] `fast-glob` にファイル走査を寄せる
- [ ] `p-retry`, `p-limit`, `p-timeout` で retry / concurrency / timeout を共通化する
- [ ] `lru-cache` で TTL キャッシュを統一する
- [ ] `ajv` で JSON Schema 検証を標準化する
- [ ] `croner` で cron 判定を標準化する
- [ ] `i18next` にエラー辞書を集約する
- [ ] `ora`, `cli-progress`, `cli-table3`, `chalk`, `diff` で CLI 出力を整理する

## 完了条件

- [ ] 自作ユーティリティの削除候補が明確になる
- [ ] handler / tool のロジック本体を触らずに共有基盤だけ整理できる
- [ ] lint / typecheck / tests が全て通る
