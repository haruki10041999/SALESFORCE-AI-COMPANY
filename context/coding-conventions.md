# Coding Conventions

## 命名規則
| 種別 | 規則 | 例 |
|---|---|---|
| Apex クラス | PascalCase | AccountService |
| テストクラス | {対象}Test | AccountServiceTest |
| Apex メソッド | camelCase | processAccounts |
| カスタムオブジェクト | PascalCase + __c | OrderLine__c |
| カスタム項目 | PascalCase + __c | PrimaryContact__c |
| LWC コンポーネント | camelCase | accountDashboard |
| Platform Event | PascalCase + __e | OrderCreated__e |

## 禁止パターン
- SOQL in loop
- DML in loop
- `SeeAllData=true` のテストクラス
- ハードコードされた Id / URL
- `without sharing` の理由なし使用
- 空の catch ブロック

## コメント規約
- `without sharing` を使う場合はクラス先頭に理由をコメントで記載する
- 複雑な業務ロジックには「なぜこの処理が必要か」をコメントする
- TODO コメントには担当者名と期限を記載する: `// TODO(yamada): 2026-06-01 までに削除`
