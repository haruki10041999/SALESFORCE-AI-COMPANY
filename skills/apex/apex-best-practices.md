# Apex ベストプラクティス

## 概要
Apex 実装で可読性・保守性・ガバナ制限耐性を同時に満たすための基準。

## いつ使うか
- 新規 Apex クラスを実装するとき
- 既存ロジックをレビューするとき
- 不具合の再発防止策を決めるとき

## 重要な原則
- 1クラス1責務を守る
- Trigger からは Handler/Service を呼ぶだけにする
- SOQL/DML をループの外へ出す
- 例外は握りつぶさず、意味のあるエラーメッセージを残す

## プラットフォーム固有の制約・数値
| 項目 | 代表上限（同期） |
|---|---|
| SOQL クエリ数 | 100 |
| DML 文数 | 150 |
| CPU Time | 10,000ms |
| Heap Size | 6MB |

## よい例・悪い例
### 悪い例
```apex
for (Account a : accounts) {
  Contact c = [SELECT Id FROM Contact WHERE AccountId = :a.Id LIMIT 1];
}
```

### よい例
```apex
Set<Id> accountIds = new Set<Id>();
for (Account a : accounts) accountIds.add(a.Id);
Map<Id, Contact> firstContactByAccount = new Map<Id, Contact>();
for (Contact c : [SELECT Id, AccountId FROM Contact WHERE AccountId IN :accountIds]) {
  if (!firstContactByAccount.containsKey(c.AccountId)) {
    firstContactByAccount.put(c.AccountId, c);
  }
}
```

## チェックリスト
- Trigger は薄く保たれているか
- SOQL/DML がループ内にないか
- 200件バルクで動作するか
- 例外ハンドリングとログ出力があるか
