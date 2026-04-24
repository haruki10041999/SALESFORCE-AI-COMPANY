# 全機能 動作検証ガイド (MCP クライアント版)

このドキュメントは、本リポジトリが提供する **88 ツールすべて** を
**Claude Desktop** または **GitHub Copilot Chat (Agent モード)** から
実際に呼び出して動作確認するための実践手順です。

> **対象**: 2026-04-24 時点 / Tools 88 件
> **想定 MCP クライアント**: Claude Desktop, VS Code GitHub Copilot Chat (Agent モード)

---

## 0. セットアップ

### 0.1 ビルド

MCP サーバを node で起動する場合は事前に build が必要。

```powershell
npm ci
npm run build
```

### 0.2 Claude Desktop 設定

`%APPDATA%\Claude\claude_desktop_config.json` (Windows) に以下を追加し、
Claude Desktop を再起動。

```json
{
  "mcpServers": {
    "salesforce-ai-company": {
      "command": "node",
      "args": [
        "D:/Projects/mult-agent-ai/salesforce-ai-company/dist/mcp/server.js"
      ]
    }
  }
}
```

`tsx` 直接起動でも可:

```json
{
  "mcpServers": {
    "salesforce-ai-company": {
      "command": "npx",
      "args": [
        "tsx",
        "D:/Projects/mult-agent-ai/salesforce-ai-company/mcp/server.ts"
      ],
      "cwd": "D:/Projects/mult-agent-ai/salesforce-ai-company"
    }
  }
}
```

**疎通確認**: Claude Desktop の入力欄左の MCP アイコンに `salesforce-ai-company` が
表示され、`88 tools` (またはそれに近い件数) が読み込まれていること。

### 0.3 VS Code GitHub Copilot Chat (Agent モード) 設定

VS Code 1.99 以降の Copilot Chat は MCP サーバを直接呼び出せます。
このリポジトリ専用に MCP を有効化する手順は以下のとおり。

#### 手順

1. **VS Code を最新版に更新** (1.99 以上が必要)
2. **GitHub Copilot Chat 拡張をインストール / 有効化**
3. リポジトリ直下に **`.vscode/mcp.json`** を作成（後述）
4. VS Code を再読み込み (`Ctrl+Shift+P` → `Developer: Reload Window`)
5. **Copilot Chat を Agent モードに切替**
   - サイドバー左の **チャットアイコン** (吹き出し型) をクリックして
     Copilot Chat パネルを開く
   - パネル下部の **入力欄の左下** にあるモードセレクタ
     （初期表示は `Ask`）をクリック
   - ドロップダウンから **`Agent`** を選択
   - 補足: モードセレクタが見当たらない場合は VS Code が古い可能性あり。
     `Help` → `Check for Updates` で 1.99+ に更新してください。
6. **`salesforce-ai-company` のツール一覧を確認**
   - 入力欄の **左下** にあるツールピッカー
     （**🛠 アイコン**、ホバーすると `Configure Tools...` と表示）をクリック
   - 開いたパネルにツリー状の一覧が出る。`salesforce-ai-company` という
     ノードを展開すると 88 個のツール (`list_agents`, `chat`,
     `smart_chat` ...) が並んでいるはず
   - 各ツール左のチェックボックスで Copilot に使わせるツールを選別できる
     （初期は全て ON でよい）
   - パネル外をクリックして閉じる

##### 🛠 アイコンが見つからない / 表示されない時

🛠 アイコンは **Agent モードでのみ表示** されます。次の順で確認してください。

1. **モードが `Agent` か確認**
   入力欄左下のセレクタが `Ask` や `Edit` のままなら、🛠 は出ません。
   一度 `Agent` を選び直す。
2. **MCP サーバが起動しているか確認**
   `Ctrl+Shift+P` → `MCP: List Servers` を実行。
   - `salesforce-ai-company` が一覧に出ない → `.vscode/mcp.json` の
     パス・JSON 構文を確認
   - 出るが `Failed` 等の状態 → 同コマンドから `Show Output` を選び
     エラーメッセージを確認 (例: `dist/mcp/server.js` が無い → `npm run build`)
3. **手動でサーバを起動 / 再起動**
   `Ctrl+Shift+P` → `MCP: Start Server` または `MCP: Restart Server`
   → `salesforce-ai-company` を選択。成功すると右下に通知が出る。
4. **`.vscode/mcp.json` の上に表示される `Start` ボタン**
   ファイルを VS Code で開くと各サーバ定義の上に Codelens で
   `Start | Stop | Restart | Show Output` が表示される。`Start` をクリック。
5. **入力欄の幅が狭すぎてアイコンが隠れていないか**
   Copilot Chat パネルの幅が狭いと右側のアイコン群に巻かれて隠れることがある。
   パネルを広げて再確認。
6. **拡張のバージョン確認**
   `拡張` ビューで GitHub Copilot / GitHub Copilot Chat を最新に更新し、
   `Developer: Reload Window`。

ここまでで一覧に出れば、各ツールにチェックを入れて手順完了です。

#### `.vscode/mcp.json` の例

```jsonc
{
  "servers": {
    "salesforce-ai-company": {
      "type": "stdio",
      "command": "node",
      "args": [
        "${workspaceFolder}/dist/mcp/server.js"
      ]
    }
  }
}
```

ビルドせず `tsx` で直接起動したい場合:

```jsonc
{
  "servers": {
    "salesforce-ai-company": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "tsx",
        "${workspaceFolder}/mcp/server.ts"
      ]
    }
  }
}
```

#### 動作確認

Copilot Chat (Agent モード) で次のように依頼:

```
list_agents を呼び出して
```

→ Copilot が `salesforce-ai-company` の `list_agents` ツール実行を提案し、
承認すると agent 一覧が返ってくれば成功です。

#### 補足

- **ツール名の表示**: Copilot Chat の UI 上では先頭に
  `mcp_salesforce-ai-company_` の接頭辞が付いて表示されます
  （例: `mcp_salesforce-ai-company_list_agents`）。本ガイド内で
  `list_agents` と書いている箇所は、Copilot Chat ではこの長い名前を選びます。
- **承認ダイアログ**: 初回ツール呼び出し時に確認が出ます。同じツールを
  繰り返し使う場合は「常に許可」を選ぶと操作が楽です。
- **このリポジトリのデフォルト動作**: [`.github/copilot-instructions.md`](../.github/copilot-instructions.md)
  に「一般依頼はまず `smart_chat`、明示指定があれば `chat`、エージェント間連携が
  欲しい時は `orchestrate_chat` から始める」というルールが書かれており、
  Copilot Chat はワークスペースを開くだけでこの方針を読み込みます。

---

## 1. 疎通スモークテスト

クライアントを起動したら、まず以下のプロンプトを順に送信して、各カテゴリの
ツールが 1 件以上応答することを確認する。

| # | クライアントへの依頼例 | 期待されるツール呼び出し |
|---|------------------------|--------------------------|
| 1 | 「`smart_chat` でこのリポジトリの構成を要約して」 | `smart_chat` |
| 2 | 「`list_agents` を実行して」 | `list_agents` |
| 3 | 「`list_skills` を実行して」 | `list_skills` |
| 4 | 「`list_personas` を実行して」 | `list_personas` |
| 5 | 「`metrics_summary` を呼び出して直近の状態を見せて」 | `metrics_summary` |

これらが応答すれば MCP 接続自体は健全。

---

## 2. カテゴリ別 動作検証 (MCP ツール呼び出し)

各セクションは **クライアントに送るプロンプト例** と **確認ポイント** で構成。
プロンプトはそのままコピペ可能。

### 2.1 静的解析 (Apex / LWC / Flow / Permission Set)

| ツール | プロンプト例 |
|--------|-------------|
| `apex_analyze` | 「`apex_analyze` で `force-app/main/default/classes/AccountService.cls` を解析して」 |
| `apex_dependency_graph` | 「`apex_dependency_graph` を `force-app/main/default/classes` に対して実行して Mermaid を出力して」 |
| `lwc_analyze` | 「`lwc_analyze` で `force-app/main/default/lwc/myComponent/myComponent.js` を解析」 |
| `flow_analyze` | 「`flow_analyze` で `force-app/main/default/flows/Account_Flow.flow-meta.xml` を解析」 |
| `permission_set_diff` | 「`permission_set_diff` で `Admin.permissionset-meta.xml` と `Standard.permissionset-meta.xml` を比較」 |
| `metadata_inventory` | 「`metadata_inventory` でこのリポジトリのメタデータ一覧を出して」 |
| `compare_org_metadata` | 「`compare_org_metadata` で `dev` 組織と `staging` 組織を比較」 |

確認: 各ツールが `content[].text` に解析結果 / Mermaid / 差分を返す。

### 2.2 リポジトリ解析

| ツール | プロンプト例 |
|--------|-------------|
| `repo_analyze` | 「`repo_analyze` でリポジトリ全体の構造を解析」 |
| `repo_inventory_summary` | 「`repo_inventory_summary` を実行」 |

### 2.3 ブランチ差分 / PR

| ツール | プロンプト例 |
|--------|-------------|
| `branch_diff_summary` | 「`branch_diff_summary` で `main` と現在ブランチの差分要約」 |
| `branch_diff_to_prompt` | 「`branch_diff_to_prompt` で同差分からレビュープロンプトを生成」 |
| `changed_tests_suggest` | 「`changed_tests_suggest` で追加すべきテストを提案」 |
| `coverage_estimate` | 「`coverage_estimate` で変更カバレッジを推定」 |
| `deployment_impact_summary` | 「`deployment_impact_summary` でデプロイ影響を要約」 |
| `deployment_plan_generate` | 「`deployment_plan_generate` で `main` → 現在ブランチのデプロイ計画を生成」 |
| `analyze_test_coverage_gap` | 「`analyze_test_coverage_gap` でテスト不足クラスを検出」 |

### 2.4 デプロイ

| ツール | プロンプト例 |
|--------|-------------|
| `deploy_org` | 「`deploy_org` で `dev` 組織への dryRun デプロイコマンドを生成」 |

確認: 生成された `sf project deploy ...` コマンド文字列が返る。

### 2.5 チャット生成 / Smart Chat / Batch

| ツール | プロンプト例 |
|--------|-------------|
| `smart_chat` | 「`smart_chat` で『Apex のトリガーをリファクタしたい』を実行」 |
| `chat` | 「`chat` で agents=`['apex-developer','qa-engineer']`、topic=『Bulk DML 対応』を実行」 |
| `simulate_chat` | 「`simulate_chat` で `chat` と同等条件を実行」 |
| `batch_chat` | 「`batch_chat` で topics=`['命名規約','例外処理','テスト']` を順次実行」 |
| `build_prompt` | 「`build_prompt` で agentName=`architect`、task=『マイクロサービス分割』のプロンプト構築」 |

**TASK-038 phase 計測の確認**:
1. 上記の `chat` または `orchestrate_chat` を 1 回実行する
2. 続けて「`metrics_summary` を実行して」と依頼
3. 出力に `phaseBreakdown` が含まれ、`input` / `plan` / `execute` / `render`
   それぞれの avg / p95 / count が表示されること

### 2.6 オーケストレーション

| ツール | プロンプト例 |
|--------|-------------|
| `orchestrate_chat` | 「`orchestrate_chat` で agents=`['product-manager','architect','qa-engineer']`、topic=『新規機能の合意形成』、turns=3 を実行」 |
| `evaluate_triggers` | 「直前の `orchestrate_chat` の sessionId を使って、lastAgent=`architect`、lastMessage=『要件あり』で `evaluate_triggers` を呼び出して」 |
| `dequeue_next_agent` | 「同 sessionId で `dequeue_next_agent` を実行」 |
| `get_orchestration_session` | 「同 sessionId で `get_orchestration_session` を実行し状態を見せて」 |
| `parse_and_record_chat` | 「以下のテキストを `parse_and_record_chat` で取り込んで:\n```\n**architect**: 設計案A\n**qa-engineer**: テスト観点\n```」 |

確認: `sessionId` が一貫して扱え、queue が更新される。

### 2.7 ログ / 履歴 / メモリ

| ツール | プロンプト例 |
|--------|-------------|
| `record_agent_message` | 「`record_agent_message` で agent=`architect`、message=『検証メモ』を記録」 |
| `get_agent_logs` | 「`get_agent_logs` で agent=`architect` の最新 5 件を取得」 |
| `archive_history` | 「`archive_history` で日付指定して履歴アーカイブ」 |
| `add_memory` | 「`add_memory` で text=『重要な前提：dev=共有 sandbox』を追加」 |
| `get_memory` (or 同等) | 「メモリ一覧を取得」 |
| `clear_memory` | 「メモリをクリア」 |
| `add_vector_record` | 「`add_vector_record` で id=`note-1`、text=『顧客は……』を追加」 |
| `query_vector_store` | 「`query_vector_store` で『顧客』を検索」 |

### 2.8 プリセット / 定義

| ツール | プロンプト例 |
|--------|-------------|
| `list_agents` / `get_agent` | 「`list_agents` を実行し、`apex-developer` の詳細を `get_agent` で表示」 |
| `list_skills` / `get_skill` | 「`list_skills` を実行し、`apex/bulkification` の詳細を `get_skill` で表示」 |
| `list_personas` / `get_persona` | 「`list_personas` を実行し `samurai` の詳細を `get_persona` で表示」 |
| `search_resources` | 「`search_resources` で query=『デプロイ』を検索」 |
| `auto_select_resources` | 「`auto_select_resources` で topic=『LWC 性能改善』を実行」 |
| `create_preset` | 「`create_preset` で name=`検証用`、agents=`['apex-developer']`、topic=`bulkify` を作成」 |
| `list_presets` / `update_preset` / `delete_preset` | 「`list_presets` → 上で作成した preset を `update_preset` で description 変更 → `delete_preset`」 |
| `run_preset` | 「`run_preset` で `Salesforce 開発レビュー` を実行」 |

### 2.9 リソースガバナンス (TASK-037 / 039 / 041)

| ツール | プロンプト例 |
|--------|-------------|
| `review_resource_governance` | 「`review_resource_governance` で現在の状態を確認」 |
| `simulate_governance_change` | 「`simulate_governance_change` で skill=`apex/test-mock` を `disable` するシミュレーション」 |
| `apply_resource_actions` (cascadeMode=block) | 「`apply_resource_actions` で skill=`apex/test-mock` を delete、cascadeMode=`block` で実行 → 依存ありなら拒否されること」 |
| `apply_resource_actions` (cascadeMode=force) | 「同条件で cascadeMode=`force` にして再実行 → 連鎖削除されること」 |
| `suggest_cleanup_resources` | 「`suggest_cleanup_resources` を dryRun で実行 → 結果に `dormant` / `burst` / `weekly` 等のラベルが付いていること」 |
| `governance_auto_cleanup_schedule` (TASK-041) | 「`governance_auto_cleanup_schedule` で action=`upsert`、name=`weekly`、cron=`0 3 * * 1`、dryRun=true を登録」<br>「同ツールで action=`list` → 登録確認」<br>「action=`delete`、name=`weekly` で削除」 |

### 2.10 イベント自動化

| ツール | プロンプト例 |
|--------|-------------|
| `update_event_automation_config` | 「`update_event_automation_config` で `error_aggregate` の閾値を 5 に変更」 |
| `get_event_automation_config` (or 同等) | 「現在の event automation 設定を取得」 |

### 2.11 メトリクス / 観測性 / ベンチマーク (TASK-044 含む)

| ツール | プロンプト例 |
|--------|-------------|
| `metrics_summary` | 「`metrics_summary` を実行し phaseBreakdown を含めて表示」 |
| `analyze_chat_trends` | 「`analyze_chat_trends` で直近の傾向を分析」 |
| `benchmark_suite` | 「`benchmark_suite` を実行し overallScore と grade を表示」 |
| `observability_dashboard` (TASK-044) | 「`observability_dashboard` を実行し `outputs/dashboards/observability.{html,md,json}` を生成して」 |

確認:
- `outputs/dashboards/observability.html` をブラウザで開けること
- benchmark の `grade` が A/B/C/D で返ること

### 2.12 学習 / シナジー / 信頼スコア (TASK-043 / 045 / 047)

| ツール | プロンプト例 |
|--------|-------------|
| `agent_ab_test` | 「`agent_ab_test` で agentA=`apex-developer`、agentB=`refactor-specialist`、topic=『trigger 整理』を比較」 |
| `synergy_recommend_combo` (TASK-043) | 「`synergy_recommend_combo` で traceLimit=200、limit=5 を実行し agent×skill の有望ペアを返して」 |
| (model registry 系) | 「shadow に新モデル登録 → promote → rollback の順で操作（TASK-045）」 |

確認:
- `synergy_recommend_combo` の戻りに `trainedFromTraces` / `pairsLearned` /
  `combos[]` が含まれる
- combos が空なら「直近 trace が不足」のメッセージを確認 (`chat` を数回実行して再試行)

---

## 3. シナリオ別 統合検証

### 3.1 「実装レビューを依頼」シナリオ

```
1. ユーザ → 「`run_preset` で `Salesforce 開発レビュー` を、変更ファイルを対象に実行」
2. ユーザ → 「`branch_diff_to_prompt` で main と現在ブランチの差分プロンプトを生成」
3. ユーザ → 「上記プロンプトを `chat` で agents=['architect','qa-engineer'] に投げて」
4. ユーザ → 「`parse_and_record_chat` で会話を保存」
5. ユーザ → 「`metrics_summary` で phase 内訳を確認」
```

確認: 各ステップの結果が連続して使用でき、最終的に history と metrics が更新される。

### 3.2 「セキュリティ確認」シナリオ

```
1. ユーザ → 「`run_preset` で `セキュリティ・コンプライアンス確認`」
2. ユーザ → 「`apex_analyze` で SOQL インジェクション疑いを検出」
3. ユーザ → 「`permission_set_diff` で過剰権限を確認」
```

### 3.3 「リリース準備」シナリオ

```
1. ユーザ → 「`run_preset` で `リリース準備チェック`」
2. ユーザ → 「`deployment_plan_generate` を実行」
3. ユーザ → 「`benchmark_suite` で grade を確認」
4. ユーザ → 「`observability_dashboard` を生成」
```

### 3.4 「ガバナンス棚卸し」シナリオ

```
1. ユーザ → 「`review_resource_governance`」
2. ユーザ → 「`suggest_cleanup_resources` で dryRun」
3. ユーザ → 「dormant 判定の skill を `apply_resource_actions` で disable (cascadeMode=block)」
4. ユーザ → 「`governance_auto_cleanup_schedule` で週次スケジュールを登録」
```

---

## 4. 出力物の検証

クライアントから一通り叩いた後、ローカルで以下のディレクトリを確認:

| 確認対象 | 場所 |
|---------|------|
| チャット履歴 | `outputs/history/YYYY-MM-DD/` |
| オーケストレーションセッション | `outputs/sessions/` |
| イベントログ | `outputs/events/system-events.jsonl` |
| トレース | `outputs/events/trace-log.jsonl` |
| メトリクスサンプル | `outputs/events/metrics-samples.jsonl` |
| ガバナンス | `outputs/resource-governance.json` |
| メモリ | `outputs/memory.jsonl` |
| ベクター | `outputs/vector-store.jsonl` |
| ベンチ結果 | `outputs/benchmark/` (TASK-050) |
| 観測ダッシュ | `outputs/dashboards/observability.{html,md,json}` (TASK-044) |
| 監査ログ | `outputs/audit/` |

---

## 5. クライアント別 注意事項

### Claude Desktop

- 1 ツール呼び出しで long-running なものは、進捗表示が出ないため
  サーバ側ログ (`%APPDATA%/Claude/logs/mcp.log` 周辺) を併読する
- ツール返却の JSON 文字列が長い場合、Claude が要約して表示することがある
  → 完全な値が必要な時はファイル出力ツール (`observability_dashboard` 等) を併用

### VS Code GitHub Copilot Chat (Agent モード)

- ツール名は `mcp_salesforce-ai_<tool>` 形式に変換されて表示される
- [`.github/copilot-instructions.md`](../.github/copilot-instructions.md) の方針に
  従い、まず `smart_chat`、特定指定時は `chat`、トリガー動作要望時は
  `orchestrate_chat` から始まる
- ツール承認ダイアログが出る場合は「常に許可」にしておくと操作が楽

---

## 6. 不具合判定とリカバリ

| 症状 | 原因の候補 | リカバリ |
|------|-----------|----------|
| ツール一覧に `salesforce-ai-company` が出ない | ビルド未実施 / 設定パス違い | `npm run build` → クライアント再起動 |
| Copilot Chat の 🛠 にサーバが現れない | `.vscode/mcp.json` が読めていない | `Ctrl+Shift+P` → `MCP: List Servers` で状態確認 → エラーがあれば `Show Output` でログ確認 → 設定修正後 `MCP: Restart Server` |
| Agent モードのドロップダウンが無い | VS Code が古い | `Help` → `Check for Updates` で 1.99+ に更新 |
| ツール件数が 88 未満 | 古い build | `npm run docs:manifest` で件数確認 → 再 build |
| `chat` が空応答 | agents 未指定 / persona ファイル欠損 | `list_agents` で存在確認 |
| `metrics_summary` の phaseBreakdown が空 | `chat` を経由していない / トレース未保存 | `chat` を 1 回実行してから再試行 |
| `synergy_recommend_combo` が空 | 完了 trace が不足 | `chat` を複数回実行 → 再試行 |
| `observability_dashboard` が落ちる | outputs 権限不足 | `outputs/dashboards/` を作成し再試行 |
| `apply_resource_actions` で予期せず削除された | cascadeMode 未指定で `force` 動作 | 必ず `block` または `prompt` を明示 |

---

## 7. 関連ドキュメント

- [verification-guide.md](./verification-guide.md): 開発変更単位の自動テスト検証
- [operations-guide.md](./operations-guide.md): 日常運用
- [architecture.md](./architecture.md): 設計概観 + サブシステム関係図
- [feature-usage-guide.md](./feature-usage-guide.md): 機能ごとの利用例
- [configuration.md](./configuration.md): 環境変数と既定値
- [internal/tool-manifest.md](./internal/tool-manifest.md): 全 88 ツールの正式仕様
- [.github/copilot-instructions.md](../.github/copilot-instructions.md): Copilot 既定動作
