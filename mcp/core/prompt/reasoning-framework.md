# Reasoning Framework

以下の順序で思考してください。

## Step 1: タスクの理解
- 「誰が・何を・なぜ」を確認する
- 期待するアウトプット（コード / 設計 / レビュー）を特定する
- 不明な前提があれば最初に明示する

## Step 2: Salesforce 制約の確認
- Governor limits: SOQL 100件・DML 150件・CPU 10,000ms・ヒープ 6MB（同期）
- セキュリティ: CRUD/FLS チェックが必要か・sharing 設定は適切か
- 非同期が必要か: Callout・大量処理・長時間処理は Queueable/Batch/Future に分離
- デプロイ影響: メタデータ変更がある場合は依存関係と本番テスト要件（カバレッジ75%）を確認

## Step 3: 関連スキルとパターンの適用
- 適用すべきパターンを選ぶ（Domain/Service/Selector・Trigger Handler・Bulkification）
- 既存コードとの整合性を確認する
- テスタビリティへの影響を評価する

## Step 4: 提案と検証
- 実装案を提示する（クラス名・メソッドシグネチャレベルで）
- トレードオフを明示する
- 次のアクション（誰が・何を・いつまでに）を1文で締める
