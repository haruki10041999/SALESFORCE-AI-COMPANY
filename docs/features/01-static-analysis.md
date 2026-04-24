# 静的解析ツール

Salesforce メタデータファイルをローカルで静的解析し、リスクや構造情報を返すツール群です。
ファイルパスの入力値は `SafeFilePathSchema` によるバリデーションが掛かっており、パストラバーサルを防止しています。

---

## apex_analyze

### 概要

Apex ソースファイル（`.cls` / `.trigger`）を読み込み、コードパターンを正規表現で走査してリスクフラグを返します。
実際のコンパイルや org 接続は不要でローカル完結です。

### 入力パラメータ

| パラメータ | 型 | 必須 | 説明 |
|---|---|---|---|
| `filePath` | string | ✓ | 解析する Apex ファイルの絶対パスまたは相対パス |

### 検出項目と判定ロジック

| フィールド | 説明 | 判定条件 |
|---|---|---|
| `hasTriggerPatternHints` | トリガー/ハンドラーパターンが存在する | `trigger ... on ...` 構文または `handler` キーワード |
| `hasSoqlInLoopRisk` | ループ内 SOQL のリスク | `for`/`while` ループ内にインライン SOQL `[SELECT...]` が存在 |
| `hasDmlInLoopRisk` | ループ内 DML のリスク | `for`/`while` ループ内に `insert`/`update`/`upsert`/`delete`/`undelete` |
| `withoutSharingUsed` | `without sharing` 宣言の使用 | `without sharing` キーワードの存在 |
| `dynamicSoqlUsed` | 動的 SOQL の使用 | `Database.query()` または `Database.countQuery()` の呼び出し |
| `hasSoqlInjectionRisk` | SOQL インジェクションリスク | 動的 SOQL の引数に文字列連結 (`+`) または `String.format()` が含まれ、`String.escapeSingleQuotes()` がない |
| `missingCrudFlsCheck` | CRUD/FLS チェック漏れ | DML 操作があるが `stripInaccessible`/`isAccessible()`/`isUpdateable()`/`isCreateable()` がない |
| `testClassDetected` | テストクラス | `@IsTest` アノテーション |
| `hasAsyncMethod` | 非同期処理 | `@future`、`Queueable` 実装、`Schedulable` 実装 |

### 入力例

```text
apex_analyze:
  filePath: "force-app/main/default/classes/AccountService.cls"
```

### 出力例

```json
{
  "path": "force-app/main/default/classes/AccountService.cls",
  "hasTriggerPatternHints": false,
  "hasSoqlInLoopRisk": true,
  "hasDmlInLoopRisk": false,
  "withoutSharingUsed": true,
  "dynamicSoqlUsed": true,
  "hasSoqlInjectionRisk": true,
  "missingCrudFlsCheck": false,
  "testClassDetected": false,
  "hasAsyncMethod": false
}
```

### 活用例

- PR レビュー前の自動チェックとして `security_delta_scan` と組み合わせる
- `withoutSharingUsed: true` かつ `missingCrudFlsCheck: true` の組み合わせは最優先修正対象

---

## lwc_analyze

### 概要

LWC の JavaScript ファイルを静的解析し、パフォーマンスリスクとセキュリティリスクを検出します。

### 入力パラメータ

| パラメータ | 型 | 必須 | 説明 |
|---|---|---|---|
| `filePath` | string | ✓ | 解析する LWC JS ファイルのパス |

### 検出項目と判定ロジック

| フィールド | 説明 | 判定条件 |
|---|---|---|
| `usesWire` | `@wire` デコレータの使用 | `@wire` の存在 |
| `hasApiDecorator` | `@api` デコレータの使用 | `@api` の存在 |
| `hasImperativeApex` | Apex の命令的呼び出し | `@salesforce/apex/` インポートがあり `@wire` がない |
| `usesNavigationMixin` | ナビゲーション使用 | `NavigationMixin.Navigate` の呼び出し |
| `usesCustomLabels` | カスタムラベル使用 | `@salesforce/label/` インポートまたは `label`/`labels` 変数 |
| `hasEventDispatch` | カスタムイベント発火 | `dispatchEvent()` または `new CustomEvent()` |
| `hasRenderedCallbackHeavyRisk` | `renderedCallback` 内の重処理リスク | `renderedCallback` 内に `querySelector`/`querySelectorAll` またはループ |
| `hasEventListenerLeakRisk` | イベントリスナーリーク | `window.addEventListener` があるが `disconnectedCallback` で `removeEventListener` していない |
| `hasUnsafeInnerHtmlRisk` | XSS リスク | `.innerHTML =` の代入または `lwc:dom="manual"` |
| `trackDecoratorCount` | `@track` デコレータ数 | `@track` の出現回数（多い場合は最新スタイルへの移行を検討） |

### 入力例

```text
lwc_analyze:
  filePath: "force-app/main/default/lwc/accountCard/accountCard.js"
```

### 出力例

```json
{
  "path": "force-app/main/default/lwc/accountCard/accountCard.js",
  "usesWire": true,
  "hasApiDecorator": true,
  "hasImperativeApex": false,
  "usesNavigationMixin": false,
  "usesCustomLabels": true,
  "hasEventDispatch": true,
  "hasRenderedCallbackHeavyRisk": false,
  "hasEventListenerLeakRisk": true,
  "hasUnsafeInnerHtmlRisk": false,
  "trackDecoratorCount": 2
}
```

### 活用例

- `hasUnsafeInnerHtmlRisk: true` は XSS につながるため即時修正
- `hasEventListenerLeakRisk: true` はメモリリークの原因になるため `disconnectedCallback` を追加
- `trackDecoratorCount > 0` は Spring '20 以降では不要な場合が多い（リアクティブプロパティで代替可）

---

## flow_analyze

### 概要

Salesforce Flow のメタデータ XML（`.flow-meta.xml`）を解析してノード数・リスクを返します。

### 入力パラメータ

| パラメータ | 型 | 必須 | 説明 |
|---|---|---|---|
| `filePath` | string | ✓ | Flow メタデータ XML のパス |

### 出力フィールド

| フィールド | 型 | 説明 |
|---|---|---|
| `decisionCount` | number | `<decisions>` 要素の数 |
| `screenCount` | number | `<screens>` 要素の数 |
| `recordCreateCount` | number | `<recordCreates>` 要素の数 |
| `recordUpdateCount` | number | `<recordUpdates>` 要素の数 |
| `recordDeleteCount` | number | `<recordDeletes>` 要素の数 |
| `subflowCount` | number | `<subflows>` 要素の数 |
| `hasApexAction` | boolean | Apex アクションを含む |
| `hasScheduledPath` | boolean | スケジュールパスを含む |
| `riskHints` | string[] | 自動生成されたリスクヒント |

### riskHints の生成条件

| 条件 | ヒント |
|---|---|
| DML 系ノード合計 ≥ 5 | ガバナ制限と再入防止を確認するよう警告 |
| `subflowCount` ≥ 3 | 実行経路の複雑化を警告 |
| Apex アクションあり | 例外伝播とトランザクション境界の確認を促す |
| スケジュールパスあり | 重複実行・遅延時の整合性確認を促す |

### 入力例

```text
flow_analyze:
  filePath: "force-app/main/default/flows/OrderFlow.flow-meta.xml"
```

### 出力例

```json
{
  "path": "force-app/main/default/flows/OrderFlow.flow-meta.xml",
  "decisionCount": 4,
  "screenCount": 2,
  "recordCreateCount": 1,
  "recordUpdateCount": 3,
  "recordDeleteCount": 1,
  "subflowCount": 4,
  "hasApexAction": true,
  "hasScheduledPath": false,
  "riskHints": [
    "DML相当処理が多いため、ガバナ制限と再入防止を確認してください。",
    "Subflow数が多く、実行経路の追跡が複雑です。",
    "Apexアクションを含むため、例外伝播とトランザクション境界を確認してください。"
  ]
}
```

---

## permission_set_analyze

### 概要

Permission Set メタデータ XML を解析し、過剰権限リスクを検出します。

### 入力パラメータ

| パラメータ | 型 | 必須 | 説明 |
|---|---|---|---|
| `filePath` | string | ✓ | `.permissionset-meta.xml` のパス |

### 出力フィールド

| フィールド | 型 | 説明 |
|---|---|---|
| `objectPermissionCount` | number | `<objectPermissions>` 要素の数 |
| `objectModifyAllCount` | number | `modifyAllRecords=true` のオブジェクト権限数 |
| `fieldPermissionCount` | number | `<fieldPermissions>` 要素の数 |
| `fieldEditCount` | number | `editable=true` のフィールド権限数 |
| `hasViewAllData` | boolean | `permissionsViewAllData=true` が存在する |
| `hasModifyAllData` | boolean | `permissionsModifyAllData=true` が存在する |
| `riskHints` | string[] | 自動生成されたリスクヒント |

### riskHints の生成条件

| 条件 | ヒント |
|---|---|
| `hasModifyAllData: true` | 最小権限の原則に違反する可能性 |
| `hasViewAllData: true` | 機密データ露出範囲の確認を促す |
| `objectModifyAllCount > 0` | 個別オブジェクトへの Modify All を警告 |
| `fieldEditCount > 50` | 過剰なフィールド編集権限の見直しを促す |

### 入力例

```text
permission_set_analyze:
  filePath: "force-app/main/default/permissionsets/Admin.permissionset-meta.xml"
```

### 出力例

```json
{
  "path": "force-app/main/default/permissionsets/Admin.permissionset-meta.xml",
  "objectPermissionCount": 12,
  "objectModifyAllCount": 2,
  "fieldPermissionCount": 48,
  "fieldEditCount": 55,
  "hasViewAllData": false,
  "hasModifyAllData": false,
  "riskHints": [
    "modifyAllRecords=true のオブジェクト権限があります。",
    "editable=true のフィールド権限が多く、過剰付与の見直し余地があります。"
  ]
}
```

---

## 関連ドキュメント

- [docs/features/02-repository-analysis.md](./02-repository-analysis.md) — ファイル棚卸し
- [docs/features/03-branch-diff-pr.md](./03-branch-diff-pr.md) — 差分ベースのセキュリティスキャン
- [docs/configuration.md](../configuration.md) — 環境変数一覧

---

## analyze_test_coverage_gap

### 概要

変更された Apex クラス / トリガーについて、対応するテストクラスが見つからない項目を検出します。
既存の `coverage_estimate` と連携し、カバレッジ推定ヒントと候補テストを併記します。

結果は JSON / Markdown レポートとして `outputs/reports/` に出力され、CI の fail 条件に利用できます。

### 入力パラメータ

| パラメータ | 型 | 必須 | 説明 |
|---|---|---|---|
| `repoPath` | string | ✓ | 対象リポジトリパス |
| `baseBranch` | string | - | 比較元ブランチ（`integrationBranch` と排他で利用） |
| `integrationBranch` | string | - | 互換パラメータ |
| `workingBranch` | string | ✓ | 作業ブランチ |
| `targetOrg` | string | - | 推奨テストコマンド生成時のターゲット Org |
| `reportOutputDir` | string | - | レポート出力先（省略時: `outputs/reports`） |
| `maxItems` | number | - | 出力する gap 上限（1〜500） |

### 出力フィールド（抜粋）

| フィールド | 型 | 説明 |
|---|---|---|
| `hasCoverageGap` | boolean | ギャップ有無 |
| `gapCount` | number | ギャップ件数 |
| `gaps` | array | テスト未対応ソース一覧 |
| `ciGate.pass` | boolean | CI 合格判定 |
| `ciGate.suggestedExitCode` | number | CI で利用可能な終了コード提案 |
| `reportJsonPath` | string | JSON レポート保存先 |
| `reportMarkdownPath` | string | Markdown レポート保存先 |

### 入力例

```text
analyze_test_coverage_gap:
  repoPath: "D:/Projects/mult-agent-ai/salesforce-ai-company"
  baseBranch: "main"
  workingBranch: "feature/coverage-gap-check"
  reportOutputDir: "outputs/reports"
  maxItems: 200
```

---

## suggest_flow_test_cases

### 概要

Flow メタデータの `<decisions><rules>` からパスを抽出し、
`coveredPaths` に含まれない未到達パス向けのテストケースを提案します。

各提案は `flow_condition_simulate` と同じ条件ツリー形式を返し、
条件を満たすサンプルレコードとシミュレーション結果を併記します。

### 入力パラメータ

| パラメータ | 型 | 必須 | 説明 |
|---|---|---|---|
| `filePath` | string | ✓ | Flow メタデータ XML ファイル |
| `coveredPaths` | string[] | - | 既に網羅済みのパスID（例: `Decision.Rule`） |
| `maxCases` | number | - | 提案ケース上限（1〜200） |
| `reportOutputDir` | string | - | レポート出力先（省略時: `outputs/reports`） |
| `includeDefaultPaths` | boolean | - | default path も未到達判定に含める |

### 出力フィールド（抜粋）

| フィールド | 型 | 説明 |
|---|---|---|
| `totalPathCount` | number | 抽出されたパス総数 |
| `uncoveredPaths` | string[] | 未到達パスID一覧 |
| `suggestedCases` | array | 条件ツリー・サンプルレコード・シミュレーション |
| `reportJsonPath` | string | JSON レポート保存先 |
| `reportMarkdownPath` | string | Markdown レポート保存先 |

### 入力例

```text
suggest_flow_test_cases:
  filePath: "force-app/main/default/flows/OrderFlow.flow-meta.xml"
  coveredPaths: ["StatusDecision.ApprovedPath"]
  maxCases: 20
```

---

## recommend_permission_sets

### 概要

最近使った Object / Field / Apex 利用シグナルを入力し、
候補 Permission Set から最小権限に近い順で推奨します。

`currentPermissionSetFile` を指定すると、各候補との差分（不足/過剰権限）も併記できます。

### 入力パラメータ

| パラメータ | 型 | 必須 | 説明 |
|---|---|---|---|
| `permissionSetFiles` | string[] | ✓ | 候補 Permission Set XML ファイル一覧 |
| `usage` | object | - | 利用シグナル（objects/fields/apexClasses/systemPermissions） |
| `usageLogFile` | string | - | 利用シグナル JSONL ログファイル |
| `currentPermissionSetFile` | string | - | 現行 Permission Set（差分比較用） |
| `objectAccessLevel` | enum | - | object に要求する最低アクセス（read/edit/create/delete） |
| `maxRecommendations` | number | - | 返却件数上限（1〜50） |
| `reportOutputDir` | string | - | レポート出力先（省略時: `outputs/reports`） |

### 出力フィールド（抜粋）

| フィールド | 型 | 説明 |
|---|---|---|
| `recommendations[].score` | number | 被覆率と過剰権限のバランススコア |
| `recommendations[].coverage` | object | 必要シグナル被覆率 |
| `recommendations[].missing` | object | 不足している権限シグナル |
| `recommendations[].excess` | object | 過剰権限件数 |
| `recommendations[].diffFromCurrent` | object | 現行との差分（指定時） |
| `reportJsonPath` | string | JSON レポート保存先 |
| `reportMarkdownPath` | string | Markdown レポート保存先 |

### 入力例

```text
recommend_permission_sets:
  permissionSetFiles:
    - "force-app/main/default/permissionsets/Support.permissionset-meta.xml"
    - "force-app/main/default/permissionsets/SupportAdmin.permissionset-meta.xml"
  usage:
    objects: ["Account", "Case"]
    fields: ["Account.Name", "Case.Subject"]
    apexClasses: ["CaseService"]
  objectAccessLevel: "read"
  maxRecommendations: 5
```
