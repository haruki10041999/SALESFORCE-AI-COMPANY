# Apex トリガーパターン

## 概要
Trigger を薄く保ち、再利用可能なハンドラ構成で保守性を高める。

## いつ使うか
- オブジェクトごとの Trigger 実装時
- Trigger の肥大化を解消したいとき

## 重要な原則
- 1オブジェクト1Trigger
- Trigger は分岐せず Handler へ委譲
- before/after ごとに責務を分ける

## プラットフォーム固有の制約・数値
- Trigger 再帰防止を考慮する
- 複数自動化（Flow/Process/Trigger）の実行順影響を考慮する

## よい例・悪い例
### 悪い例
- Trigger 内で全ロジックを直接実装

### よい例
- Trigger は `AccountTriggerHandler.run(Trigger.new, Trigger.oldMap);` のみ

## チェックリスト
- Trigger にビジネスロジックが残っていないか
- 再帰防止設計があるか
- before/after の責務が混ざっていないか
