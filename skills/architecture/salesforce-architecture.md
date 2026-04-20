# Salesforce Architecture

## 概要
Salesforce 実装を拡張可能・監査可能・運用可能にするためのアーキテクチャ指針。

## いつ使うか
- 新規プロジェクト開始時
- 既存構成の再設計時
- 非機能要件が厳しい案件での設計判断時

## 重要な原則
- Domain / Service / Selector の責務分離
- 同期処理は短く、重処理は非同期化
- 外部連携は境界（Facade）を明示して隔離

## Salesforce 固有の制約・数値
- 同期 CPU 10,000ms を超える処理は Queueable/Batch を検討
- LDV（500万件以上）では選択性とアーカイブ戦略が必須
- Platform Event / CDC / Outbound Message の使い分けを明確化

## よい例・悪い例
### 悪い例
- Trigger 内に業務判定・SOQL・DML・Callout を混在させる

### よい例
- Trigger -> Handler -> Service -> Selector と分離し、連携処理は IntegrationService に集約する

## チェックリスト
- 各層の責務が文章化されているか
- 障害時の運用導線（ログ・アラート）があるか
- 非同期化ポイントが明示されているか
- リリース単位の依存関係が管理されているか
