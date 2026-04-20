# LWC Component Structure

## 概要
LWC を責務単位で分割し、変更影響を局所化する設計パターン。

## いつ使うか
- 画面構成の初期設計時
- 巨大コンポーネント分割時

## 重要な原則
- container/presentational 分離
- 親子通信は public props + custom event で単純化
- 横断連携は LMS を利用

## Salesforce 固有の制約・数値
- `lightning/navigation` と `NavigationMixin` を標準利用
- LDS/`@wire(getRecord)` 活用で整合性を保つ

## よい例・悪い例
### 悪い例
- 子コンポーネントから直接 Apex を多重呼び出し

### よい例
- 親が取得し、子は表示専用でイベント通知のみ

## チェックリスト
- レイヤ分離が守られているか
- 通信方向が明確か
- テスト可能な構造か
