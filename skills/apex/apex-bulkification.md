# Apex Bulkification

## 概要
Apex をバルク安全にし、200件処理でも limit 超過しない実装へ導く。

## いつ使うか
- Trigger/Batch/Queueable を実装するとき
- SOQL/DML in loop を除去するとき

## 重要な原則
- 単一レコード前提を捨てる
- 収集してから一括クエリ/一括更新する
- Map/Set を活用して参照コストを下げる

## Salesforce 固有の制約・数値
- Trigger は最大200件で呼ばれる
- SOQL 100 / DML 150 の上限を超えない実装が必要

## よい例・悪い例
### 悪い例
```apex
for (Opportunity o : Trigger.new) {
  insert new Task(WhatId=o.Id, Subject='Follow up');
}
```

### よい例
```apex
List<Task> tasks = new List<Task>();
for (Opportunity o : Trigger.new) {
  tasks.add(new Task(WhatId=o.Id, Subject='Follow up'));
}
insert tasks;
```

## チェックリスト
- ループ内SOQL/DMLがないか
- Set/Mapで事前収集しているか
- 200件テストがあるか
