# Environments

## 環境構成
| 環境 | 用途 | 接続エイリアス |
|---|---|---|
| 本番（Production） | 顧客稼働中 | prod |
| Full Sandbox | 本番前統合テスト | full-sandbox |
| Developer Sandbox | 個人開発 | dev-sandbox |
| Scratch Org | CI/CD 自動テスト | （CI が自動生成） |

## デプロイフロー
Scratch Org -> Developer Sandbox -> Full Sandbox -> Production

## 本番デプロイ要件
- RunLocalTests 以上必須
- カバレッジ 75% 以上必達
- go-no-go は release-manager が判定
