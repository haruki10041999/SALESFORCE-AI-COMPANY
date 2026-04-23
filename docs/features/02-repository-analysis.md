# リポジトリ解析ツール

ローカルの Salesforce リポジトリをスキャンし、Apex/LWC/オブジェクト系ファイルを種別ごとに一覧化するツールです。

---

## repo_analyze

### 概要

指定ディレクトリ以下を再帰スキャンして、Apex ファイル・LWC JS ファイル・オブジェクト定義 XML を収集します。
Git 接続も org 接続も不要でローカル完結です。

### 入力パラメータ

| パラメータ | 型 | 必須 | 説明 |
|---|---|---|---|
| `path` | string | ✓ | スキャン対象リポジトリのルートディレクトリ |

入力値は `SafeFilePathSchema` で検証されます（パストラバーサル防止）。

### 収集対象

| カテゴリ | 対象ファイルパターン |
|---|---|
| `apex` | 拡張子 `.cls` または `.trigger` |
| `lwc` | パスに `/lwc/` を含む `.js` ファイル |
| `objects` | 拡張子 `.object-meta.xml` |

すべてのパスは POSIX 形式（`/` 区切り）に正規化されて返されます。

### 入力例

```text
repo_analyze:
  path: "D:/Projects/my-salesforce-project"
```

### 出力例

```json
{
  "apex": [
    "D:/Projects/my-salesforce-project/force-app/main/default/classes/AccountService.cls",
    "D:/Projects/my-salesforce-project/force-app/main/default/triggers/AccountTrigger.trigger"
  ],
  "lwc": [
    "D:/Projects/my-salesforce-project/force-app/main/default/lwc/accountCard/accountCard.js"
  ],
  "objects": [
    "D:/Projects/my-salesforce-project/force-app/main/default/objects/Account/Account.object-meta.xml"
  ]
}
```

### 活用例

- `smart_chat` の内部でも自動呼び出しされており、関連ファイルの自動検出に使用される
- 収集した Apex ファイルを `apex_analyze` に順番に渡して一括チェックするフローに利用する
- CI 初回コミット時のファイル棚卸しとして活用する

---

## 関連ドキュメント

- [docs/features/01-static-analysis.md](./01-static-analysis.md) — 個別ファイルの静的解析
- [docs/features/05-chat-generation.md](./05-chat-generation.md) — smart_chat（内部で repo_analyze を使用）
- [docs/configuration.md](../configuration.md) — 環境変数一覧
