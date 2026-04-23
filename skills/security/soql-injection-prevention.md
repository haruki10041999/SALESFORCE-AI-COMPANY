# SOQL インジェクション対策

## 目的

Apex で動的クエリを構築する際の SOQL インジェクションを防止します。

## チェックリスト

- 可能な限り bind 変数を使った静的 SOQL を優先する。
- Database.query / Database.countQuery 内での直接的な文字列連結を避ける。
- 動的クエリが不可避な場合は、外部入力を String.escapeSingleQuotes でサニタイズする。
- ソート対象項目、ソート方向、オブジェクト名は allowlist で検証する。
- クエリ組み立てロジックを 1 つのヘルパーメソッドに集約し、レビューしやすくする。

## 注意シグナル

- Database.query('... ' + userInput + ' ...')
- String.format でリクエスト値を WHERE 句に埋め込んでいる
- 動的 ORDER BY 値をクライアント入力から直接受け取っている
- バリデーションなしで複数メソッドにまたがってクエリ断片を連結している

## 安全パターン例

```apex
public static List<Account> searchByName(String rawName) {
  String escaped = String.escapeSingleQuotes(rawName);
  String soql = 'SELECT Id, Name FROM Account WHERE Name = \'' + escaped + '\'';
  return Database.query(soql);
}
```

## レビュー質問

- この動的クエリは静的 SOQL + bind 変数に置き換えられないか。
- ユーザー入力値はすべてエスケープ済み、または allowlist 化されているか。
- クエリ構造は固定で、可変なのは値プレースホルダーだけか。
