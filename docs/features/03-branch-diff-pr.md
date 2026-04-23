# ブランチ差分・PR レビューツール

Git ブランチ間の差分を解析し、PR 準備状況の確認・セキュリティスキャン・テスト推薦・影響範囲把握を行うツール群です。
すべてのツールはローカルの Git リポジトリに対して動作し、org 接続は不要です（一部オプションで `targetOrg` を使用）。

---

## 共通パラメータ

以下のパラメータはこのカテゴリのすべてのツールで共通です。

| パラメータ | 型 | 必須 | 説明 |
|---|---|---|---|
| `repoPath` | string | ✓ | Git 管理されたリポジトリのルートディレクトリ |
| `baseBranch` | string | ✓* | 比較元ブランチ（`integrationBranch` でも可） |
| `workingBranch` | string | ✓ | 比較先ブランチ（レビュー対象） |

`baseBranch` / `integrationBranch` はどちらかを指定してください。内部では `baseBranch...workingBranch` の三点差分が使用されます。  
ブランチ名は英数字・スラッシュ・ハイフン・アンダースコア・ドットのみ許可（コマンドインジェクション防止）。

---

## branch_diff_summary

### 概要

ブランチ間の差分ファイル数・内訳・拡張子別件数・変更シンボル名を収集して構造化データで返します。

### 追加パラメータ

| パラメータ | 型 | デフォルト | 説明 |
|---|---|---|---|
| `maxFiles` | number | 100 | 返すファイル変更詳細の上限数 |

### 出力フィールド

| フィールド | 型 | 説明 |
|---|---|---|
| `comparison` | string | `baseBranch...workingBranch` 形式の比較識別子 |
| `filesChanged` | number | 変更ファイル総数 |
| `added` | number | 追加ファイル数 |
| `modified` | number | 変更ファイル数 |
| `deleted` | number | 削除ファイル数 |
| `renamed` | number | リネームファイル数 |
| `copied` | number | コピーファイル数 |
| `fileTypeBreakdown` | object | 拡張子別ファイル数 |
| `fileChanges` | array | ファイルごとの詳細（`path`, `status`, `additions`, `deletions`, `touchedSymbols`） |
| `summary` | string | 変更サマリーテキスト |

`touchedSymbols` は差分パッチから抽出した変更クラス名・メソッド名の一覧です。

### 入力例

```text
branch_diff_summary:
  repoPath: "D:/Projects/my-salesforce-project"
  baseBranch: "main"
  workingBranch: "feature/account-refactor"
  maxFiles: 30
```

### 出力例（抜粋）

```json
{
  "comparison": "main...feature/account-refactor",
  "filesChanged": 5,
  "added": 1,
  "modified": 3,
  "deleted": 1,
  "renamed": 0,
  "copied": 0,
  "fileTypeBreakdown": { "cls": 3, "js": 1, "xml": 1 },
  "fileChanges": [
    {
      "path": "force-app/main/default/classes/AccountService.cls",
      "status": "M",
      "additions": 42,
      "deletions": 15,
      "touchedSymbols": ["AccountService", "getAccountById", "updateAccount"]
    }
  ],
  "summary": "5 files changed: 1 added, 3 modified, 1 deleted"
}
```

---

## branch_diff_to_prompt

### 概要

差分情報をレビュー用の会話プロンプト（マルチターン形式）に変換します。
`chat` / `orchestrate_chat` と組み合わせてコードレビューセッションを開始する際に使用します。

### 追加パラメータ

| パラメータ | 型 | デフォルト | 説明 |
|---|---|---|---|
| `topic` | string | — | プロンプトのレビューテーマ（任意） |
| `turns` | number | 6 | 生成するプロンプトの会話ターン数 |
| `maxHighlights` | number | 10 | ハイライトするファイル変更件数の上限 |

### 出力フィールド

| フィールド | 型 | 説明 |
|---|---|---|
| `prompt` | string | 生成されたレビュー用プロンプト |
| `comparison` | string | 比較識別子 |
| `highlightedFiles` | array | 特に注目すべきファイルの一覧 |

### 入力例

```text
branch_diff_to_prompt:
  repoPath: "D:/Projects/my-salesforce-project"
  baseBranch: "main"
  workingBranch: "feature/account-refactor"
  topic: "リリース前コードレビュー"
  turns: 8
  maxHighlights: 10
```

---

## pr_readiness_check

### 概要

PR のマージ準備状況をスコアリングしてゲート判定（`ready` / `needs-review` / `blocked`）を返します。
オプションで多言語レビューコメントを解析して判定を上書きする機能と、SARIF/JUnit 出力フォーマットに対応します。

### 追加パラメータ

| パラメータ | 型 | 説明 |
|---|---|---|
| `reviewText` | string | レビューコメントテキスト（多言語対応） |
| `format` | string | 出力フォーマット: `json`（デフォルト）/ `sarif` / `junit` |

### 多言語レビューキーワード

| 判定 | 認識キーワード例 |
|---|---|
| `ready` | lgtm, approved, 承認, 問題なし, ok to merge, aprobado, 批准, 승인 ... |
| `needs-review` | needs review, 要確認, 再レビュー, revisar, 검토 필요 ... |
| `blocked` | request changes, must fix, 要修正, 差し戻し, マージ不可, 必须修复, blockiert ... |

優先順位: `blocked` > `needs-review` > `ready`

### 出力フィールド

| フィールド | 型 | 説明 |
|---|---|---|
| `score` | number | 準備度スコア（0〜100） |
| `gate` | string | 最終ゲート判定（`ready` / `needs-review` / `blocked`） |
| `baseGate` | string | スコアのみに基づくゲート（`reviewText` の影響なし） |
| `changedFiles` | number | 変更ファイル総数 |
| `recommendedAgents` | string[] | 推奨レビューエージェント |
| `checklist` | array | チェックリスト項目（`id`, `title`, `status`, `detail`） |
| `reviewSignal` | object / null | `{ decision, matchedKeywords }` または null |
| `summary` | string | 判定サマリーテキスト |

### 入力例（基本）

```text
pr_readiness_check:
  repoPath: "D:/Projects/my-salesforce-project"
  baseBranch: "main"
  workingBranch: "feature/account-refactor"
```

### 入力例（レビューコメント付き）

```text
pr_readiness_check:
  repoPath: "D:/Projects/my-salesforce-project"
  baseBranch: "main"
  workingBranch: "feature/account-refactor"
  reviewText: "LGTM。テスト追加も確認しました。承認します"
```

### 入力例（SARIF 形式）

```text
pr_readiness_check:
  repoPath: "D:/Projects/my-salesforce-project"
  baseBranch: "main"
  workingBranch: "feature/account-refactor"
  format: "sarif"
```

---

## security_delta_scan

### 概要

差分の追加行のみを対象にセキュリティリスクパターンを検出します。
コメントやリテラル文字列は前処理で除去してから評価するため、誤検知を低減しています。

### 追加パラメータ

| パラメータ | 型 | デフォルト | 説明 |
|---|---|---|---|
| `maxFindings` | number | 50 | 返す検出件数の上限 |

### 検出ルール

| ルール ID | 深刻度 | 説明 |
|---|---|---|
| `sharing-rule` | high | `without sharing` が追加行に含まれる |
| `dynamic-soql` | high | `Database.query()` または `Database.countQuery()` が追加行に含まれる |
| `soql-injection` | high | 動的 SOQL の引数に文字列連結があり `String.escapeSingleQuotes` がない |
| `dml-in-loop` | medium | ループ内に DML 操作がある |
| `crud-fls-missing` | medium | DML 操作があるが CRUD/FLS チェックがない |
| `unsafe-innerhtml` | high | `.innerHTML =` 代入または `lwc:dom="manual"` |
| `hardcoded-id` | medium | 15桁または18桁の Salesforce ID がハードコードされている |

### 出力フィールド

| フィールド | 型 | 説明 |
|---|---|---|
| `comparison` | string | 比較識別子 |
| `findings` | array | 検出結果（`severity`, `filePath`, `rule`, `detail`） |
| `summary` | string | 検出サマリーテキスト |

### 入力例

```text
security_delta_scan:
  repoPath: "D:/Projects/my-salesforce-project"
  baseBranch: "main"
  workingBranch: "feature/account-refactor"
  maxFindings: 50
```

### 出力例

```json
{
  "comparison": "main...feature/account-refactor",
  "findings": [
    {
      "severity": "high",
      "filePath": "force-app/main/default/classes/AccountService.cls",
      "rule": "dynamic-soql",
      "detail": "動的SOQL呼び出しが追加されています。バインド変数またはエスケープの検証が必要です。"
    }
  ],
  "summary": "1 finding(s) detected: 1 high, 0 medium"
}
```

---

## deployment_impact_summary

### 概要

差分に含まれるメタデータを種別ごとに集計し、削除・変更の影響範囲を構造化データで返します。

### 出力フィールド

| フィールド | 型 | 説明 |
|---|---|---|
| `comparison` | string | 比較識別子 |
| `totalChanges` | number | 変更メタデータ総数 |
| `deletions` | number | 削除されたメタデータ数 |
| `metadataBreakdown` | object | メタデータ種別ごとの変更件数 |
| `cautions` | string[] | 注意事項（削除・権限系メタデータ等） |
| `summary` | string | サマリーテキスト |

### 入力例

```text
deployment_impact_summary:
  repoPath: "D:/Projects/my-salesforce-project"
  baseBranch: "main"
  workingBranch: "feature/account-refactor"
```

---

## changed_tests_suggest

### 概要

差分ファイルから変更された Apex クラス・LWC コンポーネントを特定し、実行すべきテストクラス名を推薦します。
`targetOrg` を指定すると `sf apex run test` コマンドも生成します。

### 追加パラメータ

| パラメータ | 型 | 説明 |
|---|---|---|
| `targetOrg` | string | Salesforce org エイリアスまたはユーザー名（英数字・ハイフン・アンダースコア・ドット・`@` のみ許可） |

### テスト名推薦ロジック

- Apex クラス `AccountService.cls` → `AccountServiceTest`（高優先）、`AccountServiceTests`（中優先・命名ゆらぎ対策）
- LWC コンポーネント `accountCard` → `accountCardControllerTest`

### 出力フィールド

| フィールド | 型 | 説明 |
|---|---|---|
| `comparison` | string | 比較識別子 |
| `changedSourceFiles` | string[] | 変更された Apex/LWC ファイル一覧 |
| `suggestions` | array | テスト推薦（`testName`, `reason`, `priority`） |
| `runCommand` | string? | `sf apex run test` コマンド（`targetOrg` 指定時のみ） |
| `summary` | string | サマリーテキスト |

### 入力例

```text
changed_tests_suggest:
  repoPath: "D:/Projects/my-salesforce-project"
  baseBranch: "main"
  workingBranch: "feature/account-refactor"
  targetOrg: "devhub"
```

### 出力例

```json
{
  "comparison": "main...feature/account-refactor",
  "changedSourceFiles": [
    "force-app/main/default/classes/AccountService.cls"
  ],
  "suggestions": [
    { "testName": "AccountServiceTest", "reason": "AccountService.cls の差分に対応", "priority": "high" },
    { "testName": "AccountServiceTests", "reason": "AccountService.cls の命名ゆらぎ対策", "priority": "medium" }
  ],
  "runCommand": "sf apex run test --target-org devhub --class-names AccountServiceTest,AccountServiceTests",
  "summary": "1 source file(s) changed; 2 test suggestion(s)"
}
```

---

## coverage_estimate

### 概要

変更された Apex/LWC ファイルに対して、ブランチ上の既存テストファイルとの名前一致・内容参照により、テストカバレッジ対応状況の推定を返します。

### 追加パラメータ

| パラメータ | 型 | 説明 |
|---|---|---|
| `targetOrg` | string | Salesforce org エイリアス（指定時に `runCommand` を生成） |

### 信頼度（confidence）の意味

| 値 | 説明 |
|---|---|
| `high` | テストファイルが存在し、ファイル内容がソースクラス名を明示的に参照している |
| `medium` | テストファイル名がソース名に基づく命名規則に一致するが内容は未確認 |
| `low` | 名前一致なし、またはテスト候補がない |

### 出力フィールド

| フィールド | 型 | 説明 |
|---|---|---|
| `comparison` | string | 比較識別子 |
| `changedSourceFiles` | string[] | 変更された Apex/LWC ファイル一覧 |
| `mappings` | array | ファイルごとのカバレッジマッピング |
| `overallCoverageHint` | string | 全体的なカバレッジヒント（`high`/`medium`/`low`/`none`） |
| `recommendedTests` | string[] | 高信頼度のテストクラス名一覧 |
| `runCommand` | string? | `sf apex run test` コマンド（`targetOrg` 指定時のみ） |
| `summary` | string | サマリーテキスト |

### 入力例

```text
coverage_estimate:
  repoPath: "D:/Projects/my-salesforce-project"
  baseBranch: "main"
  workingBranch: "feature/account-refactor"
  targetOrg: "devhub"
```

---

## metadata_dependency_graph

### 概要

差分で変更・削除された `CustomObject` および `CustomField` が他メタデータ（Apex・Flow・PermissionSet 等）から参照されているかを検出します。
削除系の変更がある場合の影響調査に特に有効です。

### 追加パラメータ

| パラメータ | 型 | デフォルト | 説明 |
|---|---|---|---|
| `maxReferences` | number | 100 | 返す参照件数の上限 |

### 解析対象

- 変更/削除された `CustomField`（`.field-meta.xml`）の API 名が他ファイル内で参照されているか
- 変更/削除された `CustomObject`（`.object-meta.xml`）の API 名が他ファイル内で参照されているか

### 参照先として検索されるファイル種別

`.cls`, `.trigger`, `.js`, `.ts`, `.flow-meta.xml`, `.permissionset-meta.xml`, `.profile-meta.xml`

### 出力フィールド

| フィールド | 型 | 説明 |
|---|---|---|
| `comparison` | string | 比較識別子 |
| `targets` | array | 変更対象メタデータごとの参照情報 |
| `summary` | string | サマリーテキスト |

`targets` 配列の各要素:

| フィールド | 型 | 説明 |
|---|---|---|
| `kind` | string | `CustomField` または `CustomObject` |
| `status` | string | `A`（追加）/ `M`（変更）/ `D`（削除） |
| `apiName` | string | フィールド/オブジェクトの API 名 |
| `references` | array | 参照箇所（`filePath`, `line`, `snippet`） |
| `risk` | string | `high`（削除）/ `medium`（変更）/ `low`（追加） |

### 入力例

```text
metadata_dependency_graph:
  repoPath: "D:/Projects/my-salesforce-project"
  baseBranch: "main"
  workingBranch: "feature/remove-old-field"
  maxReferences: 50
```

---

## 推奨ワークフロー

### PR マージ可否判断フロー

```
1. branch_diff_summary       # 変更規模の把握
2. security_delta_scan       # セキュリティリスク検出
3. metadata_dependency_graph # 削除/変更の影響範囲確認
4. coverage_estimate         # テストカバレッジ状況確認
5. pr_readiness_check        # 総合スコアとゲート判定
```

### デプロイ前影響調査フロー

```
1. deployment_impact_summary # メタデータ種別別の変更集計
2. metadata_dependency_graph # 依存関係の確認
3. changed_tests_suggest     # 実行すべきテストを特定
```

---

## 関連ドキュメント

- [docs/features/04-deployment.md](./04-deployment.md) — デプロイコマンド生成・デプロイ計画
- [docs/features/01-static-analysis.md](./01-static-analysis.md) — 単体ファイル解析
- [docs/configuration.md](../configuration.md) — 環境変数一覧
