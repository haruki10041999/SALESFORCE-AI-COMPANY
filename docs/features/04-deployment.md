# デプロイ・テスト実行ツール

Salesforce org へのデプロイコマンド生成・テスト実行コマンド生成・デプロイ計画の作成を行うツール群です。
いずれもコマンドを**生成**するツールであり、実際のデプロイ実行や org 接続は行いません。

---

## deploy_org

### 概要

`sf project deploy start` コマンド文字列を生成します。
`targetOrg` / `sourceDir` 等の入力値はコマンドインジェクション対策のバリデーションが掛かっています。

### 入力パラメータ

| パラメータ | 型 | 必須 | デフォルト | 説明 |
|---|---|---|---|---|
| `targetOrg` | string | ✓ | — | デプロイ先 org のエイリアスまたはユーザー名 |
| `dryRun` | boolean | — | `true` | `true` のとき `--check-only` を付与（検証のみ） |
| `sourceDir` | string | — | `force-app` | デプロイするソースディレクトリ |
| `testLevel` | string | — | `RunLocalTests` | テストレベル: `NoTestRun` / `RunLocalTests` / `RunAllTestsInOrg` / `RunSpecifiedTests` |
| `specificTests` | string[] | — | — | `testLevel: RunSpecifiedTests` のとき実行するテストクラス名一覧 |
| `wait` | number | — | `33` | コマンドのタイムアウト分数 |
| `ignoreWarnings` | boolean | — | `false` | `true` のとき `--ignore-warnings` を付与 |

### セキュリティ

- `targetOrg` は `OrgIdentifierSchema`（英数字・ハイフン・アンダースコア・ドット・`@` のみ）で検証
- `sourceDir` は `SafeFilePathSchema`（パストラバーサル文字禁止）で検証
- `;` `&` `|` バッククォート `$` `<` `>` `\` `"` `\n` `\r` が含まれる入力はエラー

### 出力フィールド

| フィールド | 型 | 説明 |
|---|---|---|
| `command` | string | 生成された `sf project deploy start` コマンド |
| `dryRun` | boolean | 検証モード（`--check-only`）かどうか |

### 入力例（検証のみ）

```text
deploy_org:
  targetOrg: "devhub"
  dryRun: true
```

### 入力例（実行・RunSpecifiedTests）

```text
deploy_org:
  targetOrg: "staging-sandbox"
  dryRun: false
  sourceDir: "force-app"
  testLevel: "RunSpecifiedTests"
  specificTests: ["AccountServiceTest", "OrderFlowTest"]
  wait: 60
```

### 出力例

```json
{
  "command": "sf project deploy start --target-org staging-sandbox --source-dir force-app --test-level RunSpecifiedTests --tests AccountServiceTest,OrderFlowTest --wait 60",
  "dryRun": false
}
```

---

## run_tests

### 概要

`sf apex run test` コマンド文字列を生成します。
テストクラス名やスイート名を指定すると、該当スコープに絞ったコマンドが生成されます。

### 入力パラメータ

| パラメータ | 型 | 必須 | デフォルト | 説明 |
|---|---|---|---|---|
| `targetOrg` | string | ✓ | — | テスト実行先 org |
| `classNames` | string[] | — | — | 実行するテストクラス名の一覧 |
| `suiteName` | string | — | — | テストスイート名 |
| `wait` | number | — | `30` | コマンドのタイムアウト分数 |
| `outputDir` | string | — | — | テスト結果の出力ディレクトリ |

### セキュリティ

- `targetOrg` は `OrgIdentifierSchema` で検証
- `classNames` の各要素・`suiteName`・`outputDir` も注入文字チェック済み
- `outputDir` は `SafeFilePathSchema` で追加検証

### 入力例（全ローカルテスト）

```text
run_tests:
  targetOrg: "devhub"
```

### 入力例（クラス指定）

```text
run_tests:
  targetOrg: "devhub"
  classNames: ["AccountServiceTest", "OrderServiceTest"]
  wait: 45
  outputDir: "test-results"
```

### 出力例

```
sf apex run test --target-org devhub --class-names AccountServiceTest,OrderServiceTest --wait 45 --output-dir test-results
```

---

## deployment_plan_generate

### 概要

ブランチ差分を解析してデプロイ計画を生成します。変更規模・削除件数・感受性の高いメタデータ（PermissionSet/Flow 等）からリスクレベルを算定し、推奨デプロイ順序・事前/事後チェック・ロールバック手順をまとめた構造化データを返します。

### 入力パラメータ

共通パラメータ（`repoPath`, `baseBranch`, `workingBranch`）に加えて:

| パラメータ | 型 | 説明 |
|---|---|---|
| `targetOrg` | string | デプロイ先 org（コマンドプレビューに使用） |

### リスクレベル判定ロジック

| リスクレベル | 条件 |
|---|---|
| `high` | 削除メタデータ ≥ 3 件、または PermissionSet+Profile+Flow+ApexTrigger の合計変更 ≥ 6 件 |
| `medium` | 削除メタデータ ≥ 1 件、または感受性メタデータ ≥ 3 件 |
| `low` | 上記に該当しない |

### 出力フィールド

| フィールド | 型 | 説明 |
|---|---|---|
| `comparison` | string | 比較識別子 |
| `riskLevel` | string | `low` / `medium` / `high` |
| `recommendedOrder` | string[] | 推奨デプロイ順序（5段階） |
| `preChecks` | string[] | デプロイ前チェックリスト |
| `deployCommandPreview` | string | 生成されたデプロイコマンドプレビュー |
| `postChecks` | string[] | デプロイ後チェックリスト |
| `rollbackHints` | string[] | ロールバック手順ヒント |
| `cautions` | string[] | 注意事項 |

### 推奨デプロイ順序（固定）

```
1) 権限・設定メタデータ (PermissionSet/Profile)
2) データモデル (CustomObject/CustomField)
3) 実装 (ApexClass/ApexTrigger/LWC)
4) 自動化 (Flow)
5) レイアウト・補助設定
```

### 入力例

```text
deployment_plan_generate:
  repoPath: "D:/Projects/my-salesforce-project"
  baseBranch: "main"
  workingBranch: "feature/major-release"
  targetOrg: "production"
```

### 出力例

```json
{
  "comparison": "main...feature/major-release",
  "riskLevel": "medium",
  "recommendedOrder": [
    "1) 権限・設定メタデータ (PermissionSet/Profile)",
    "2) データモデル (CustomObject/CustomField)",
    "3) 実装 (ApexClass/ApexTrigger/LWC)",
    "4) 自動化 (Flow)",
    "5) レイアウト・補助設定"
  ],
  "preChecks": [
    "対象 org のバックアップ/スナップショットを取得",
    "変更対象メタデータの依存関係を確認",
    "削除差分がある場合は影響オブジェクト一覧を作成",
    "RunLocalTests 以上での検証計画を作成"
  ],
  "deployCommandPreview": "sf project deploy start --target-org production --source-dir force-app --test-level RunLocalTests --wait 33",
  "postChecks": [
    "Apex テスト結果を確認 (失敗/カバレッジ)",
    "Flow の起動条件・重複自動化を検証",
    "権限差分に伴うユーザー操作テストを実施",
    "主要業務シナリオのスモークテストを実施"
  ],
  "rollbackHints": [
    "直前コミットを基準に逆差分デプロイ手順を用意",
    "削除メタデータは復元用マニフェストを事前生成",
    "高リスク変更は段階リリース (機能フラグ/順次配備) を採用"
  ],
  "cautions": []
}
```

---

## run_deployment_verification

### 概要

デプロイ後のスモークテスト結果を評価し、`rollback` / `continue` / `monitor` を判定します。
判定内容は JSON / Markdown レポートとして `outputs/reports/` に出力できます。

`dryRun: true` ではコマンドと判定ロジックのみを確認し、`dryRun: false` では実測の `smokeResult` を入力して本番判定を行います。

### 入力パラメータ

| パラメータ | 型 | 必須 | デフォルト | 説明 |
|---|---|---|---|---|
| `targetOrg` | string | ✓ | — | 検証対象 org |
| `dryRun` | boolean | — | `true` | `false` の場合は実測結果に基づく判定 |
| `deploymentSucceeded` | boolean | — | `true` | デプロイ結果フラグ |
| `smokeClassNames` | string[] | — | — | スモークテスト対象クラス |
| `smokeSuiteName` | string | — | — | スモークテスト対象スイート |
| `wait` | number | — | `30` | テストコマンドの待機時間（分） |
| `outputDir` | string | — | — | テスト出力先 |
| `smokeResult.totalTests` | number | — | — | 実行総テスト数 |
| `smokeResult.failedTests` | number | — | — | 失敗テスト数 |
| `smokeResult.passedTests` | number | — | 推定 | 成功テスト数 |
| `smokeResult.skippedTests` | number | — | `0` | スキップ数 |
| `smokeResult.criticalFailures` | number | — | `0` | 重大障害件数 |
| `failureRateThresholdPercent` | number | — | `5` | ロールバック判定の失敗率閾値 |
| `criticalFailureThreshold` | number | — | `1` | 重大障害のロールバック閾値 |
| `reportOutputDir` | string | — | `outputs/reports` | レポート出力先 |

### 判定ルール（要点）

- `deploymentSucceeded: false` の場合は即 `rollback`
- `dryRun: false` かつ `criticalFailures >= criticalFailureThreshold` で `rollback`
- `dryRun: false` かつ `failureRatePercent > failureRateThresholdPercent` で `rollback`
- 失敗 0 件なら `continue`
- それ以外は `monitor`

### 入力例

```text
run_deployment_verification:
  targetOrg: "production"
  dryRun: false
  deploymentSucceeded: true
  smokeClassNames: ["OrderServiceTest", "InvoiceServiceTest"]
  smokeResult:
    totalTests: 40
    passedTests: 38
    failedTests: 2
    criticalFailures: 0
  failureRateThresholdPercent: 5
```

### 出力例（抜粋）

```json
{
  "mode": "live",
  "targetOrg": "production",
  "decision": {
    "recommendedAction": "monitor",
    "shouldRollback": false,
    "reason": "smoke tests have partial failures (5.00%), below rollback threshold"
  },
  "reportJsonPath": "D:/Projects/mult-agent-ai/salesforce-ai-company/outputs/reports/deployment-verification-2026-04-24T11-00-00-000Z.json",
  "reportMarkdownPath": "D:/Projects/mult-agent-ai/salesforce-ai-company/outputs/reports/deployment-verification-2026-04-24T11-00-00-000Z.md"
}
```

---

## 推奨ワークフロー

### リリース前デプロイ準備フロー

```
1. deployment_impact_summary   # 変更規模の把握（docs/features/03-branch-diff-pr.md）
2. metadata_dependency_graph   # 削除/変更の影響範囲確認
3. deployment_plan_generate    # 計画・リスク・コマンドプレビューを取得
4. changed_tests_suggest       # 実行すべきテストを特定
5. deploy_org (dryRun: true)   # 検証コマンドを生成して手動実行
6. run_tests                   # テストコマンドを生成して手動実行
7. run_deployment_verification # 実測結果から rollback/continue/monitor を判定
```

---

## 関連ドキュメント

- [docs/features/03-branch-diff-pr.md](./03-branch-diff-pr.md) — ブランチ差分・影響範囲解析
- [docs/features/11-metrics-benchmarks.md](./11-metrics-benchmarks.md) — ツール実行統計
- [docs/configuration.md](../configuration.md) — 環境変数一覧
