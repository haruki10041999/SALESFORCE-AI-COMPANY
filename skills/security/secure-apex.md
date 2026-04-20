# Secure Apex

## 概要
Apex の実装で CRUD/FLS/Sharing を強制し、データ露出を防ぐための実践ガイド。

## いつ使うか
- @AuraEnabled メソッドを実装するとき
- REST API / Queueable でデータ更新を行うとき
- セキュリティレビューの観点を整理するとき

## 重要な原則
- 最小権限で実行する
- 入出力の両方でアクセス制御を検証する
- 動的SOQLは原則バインド変数で組み立てる

## Salesforce 固有の制約・数値
- CRUD: `isAccessible/isCreateable/isUpdateable/isDeletable`
- FLS: `SObjectType.Field.isAccessible/isUpdateable`
- 共有制御: `with sharing` / `inherited sharing`
- 結果の安全化: `Security.stripInaccessible()`

## よい例・悪い例
### 悪い例
```apex
String soql = 'SELECT Id, Name FROM Account WHERE Name = \'" + keyword + "\'';
List<Account> rows = Database.query(soql);
```

### よい例
```apex
List<Account> rows = [SELECT Id, Name FROM Account WHERE Name = :keyword];
SObjectAccessDecision dec = Security.stripInaccessible(AccessType.READABLE, rows);
List<Account> safeRows = (List<Account>)dec.getRecords();
```

## チェックリスト
- CRUD/FLS チェックがあるか
- `with sharing` か `inherited sharing` を意図的に選んでいるか
- 動的SOQLに入力連結がないか
- APIレスポンスに機密項目が含まれていないか
