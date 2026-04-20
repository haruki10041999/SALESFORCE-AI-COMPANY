# Apex Testing

## 概要
Apex ロジックの品質を保証するテスト設計指針。

## いつ使うか
- 新規機能追加時
- バグ修正時
- デプロイ前の品質判定時

## 重要な原則
- SeeAllData=false を原則にする
- テストは仕様を表現する
- 正常系・異常系・境界値・バルクを必ず分ける

## Salesforce 固有の制約・数値
- 本番デプロイには org 全体で 75% カバレッジが必要
- `Test.startTest()/stopTest()` で非同期処理完了を検証
- 1トランザクション200件バルクを想定した検証を行う

## よい例・悪い例
### 悪い例
- `System.assert(true);` だけで振る舞いを確認しない

### よい例
```apex
@IsTest
private class InvoiceServiceTest {
  @TestSetup
  static void setup() {
    insert new Account(Name='Acme');
  }

  @IsTest
  static void shouldCreateInvoiceFor200Records() {
    List<Account> rows = [SELECT Id FROM Account LIMIT 1];
    Test.startTest();
    InvoiceService.createInvoices(rows);
    Test.stopTest();
    System.assertEquals(1, [SELECT count() FROM Invoice__c]);
  }
}
```

## チェックリスト
- @TestSetup を利用しているか
- 非同期処理を stopTest 後に検証しているか
- 期待値がビジネスルールに対応しているか
- 失敗時に原因が分かる assert メッセージか
