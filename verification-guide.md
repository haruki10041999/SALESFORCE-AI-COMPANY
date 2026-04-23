# salesforce-ai-company 動作検証ガイド

> リポジトリ: `D:\Projects\mult-agent-ai\salesforce-ai-company`  
> 作成日: 2026-04-20

関連ドキュメント:
- README: 全体像と起動手順
- docs/documentation-map.md: ドキュメント索引
- docs/feature-usage-guide.md: ツール利用例

---

## 検証の前提

### 環境準備

```bash
# 依存インストール
npm install

# 初回のみ: outputs/ の初期化
npm run init

# TypeScript ビルド
npm run build

# 開発起動
npm run mcp:dev

# 型チェックのみ（CI 推奨）
npm run typecheck

# テスト実行（全件）
npm test

# outputs 健全性チェック
npm run doctor

# metrics サマリー
npm run metrics:report -- --top 10

# metrics ダッシュボード生成
npm run metrics:dashboard

# outputs クリーンアップ（事前確認）
npm run outputs:cleanup -- --dry-run

# テスト実行（個別）
node --test --import tsx --import ./tests/_setup.ts tests/server-tools.integration.test.ts
```

> **環境変数**  
> `SF_AI_OUTPUTS_DIR=/path/to/outputs` を設定すると `outputs/` の場所を変更できます。  
> `LOG_LEVEL=debug` でサーバー詳細ログを有効化できます（`error` / `warn` / `info` / `debug`）。

### 検証の種別

| 種別 | 対象 | 方法 |
|---|---|---|
| **自動テスト** | コアロジック・ツール登録・統合動作 | `npm test` |
| **MCP クライアント検証** | Claude Desktop / VS Code から実際に呼ぶ | 手動 |
| **プロンプト品質検証** | LLM が正しく動作するかを確認 | LLM に渡して評価 |

---

## 1. 自動テスト検証

### 1-1. テストファイル一覧と検証範囲

| ファイル | 検証範囲 | 主要確認項目 |
|---|---|---|
| `server-tools.integration.test.ts` | ツール登録・E2E | 全ツール名の登録確認・イベント自動無効化・`once` ルール・fallback 無効化 |
| `core-tools.test.ts` | 静的解析ツール | `analyzeRepo` / `analyzeApex` / `analyzeLwc` / `buildDeployCommand` / `buildTestCommand` |
| `advanced-tools.test.ts` | 高度なツール動作 | `branch_diff` 系・`pr_readiness` 等 |
| `branch-diff-tools.test.ts` | 差分解析ツール | `summarizeBranchDiff` / `buildBranchDiffPrompt` |
| `apply-resource-actions.test.ts` | リソース品質チェック | 品質チェック・重複検出・統合バリデーション |
| `core-modules.test.ts` | コアモジュール | スコアリング・ギャップ検出・ガバナンス |
| `handlers-modules.test.ts` | ハンドラー | 6ハンドラーの登録・動作 |
| `memory-prompt.test.ts` | メモリ・プロンプト | `add/search/list/clear` memory・`buildPrompt` |
| `governance-event-reliability.test.ts` | 堅牢性 | Governance state 並行書き込み・EventDispatcher 失敗リスナー自動隔離 |
| `chat-prompt-building.test.ts` | プロンプト生成 | context 注入・レビューセクション注入・トピックキーワードによる review mode |

### 1-2. テスト実行と期待結果

```bash
# 全テスト実行
npm test

# 期待結果: すべて pass
# NG になりやすい箇所:
# - server-tools.integration.test.ts の "server exposes expected core tool registrations"
#   → ツール追加時にリストが未更新だと fail
```

### 1-3. テストカバレッジ状況

以下の項目は自動テストで検証済みです。

- `buildChatPrompt()` の `context/` 自動注入（`## プロジェクトコンテキスト`・`## ディスカッション規約`）
- `discussion-framework.md` / `review-framework.md` の注入タイミング
- `reviewModeTriggered` フラグ（topic に「レビュー/確認/チェック」が含まれる場合の review-mode.md 注入）
- `orchestrate_chat` → `evaluate_triggers`（`once` ルール・ラウンドロビン fallback）→ `dequeue_next_agent` の一連の流れ
- Governance state の並行書き込みによる JSON 破損防止
- EventDispatcher でのリスナー連続失敗による自動隔離

以下は引き続き手動検証が必要です。

- `error_aggregate_detected` イベントによるツール自動無効化の復旧フロー（LLM 経由の E2E）
- プロンプト出力の LLM 動作品質（response quality）

---

## 2. MCP クライアント検証（手動）

Claude Desktop または VS Code から MCP サーバーに接続して実施する。

### 2-1. 接続確認

**検証手順**

1. `npm run build` の後に `npm run mcp:start` または `npm run mcp:dev` で MCP サーバーを起動
2. Claude Desktop の設定に `salesforce-ai-company` を登録
3. 以下のツールを呼んで正常応答を確認

```
list_agents → エージェント一覧が返ること
list_skills → スキル一覧が返ること
get_context → context/ の内容が返ること（FEAT-A の注入内容確認）
```

**確認観点**

- `list_agents` の件数が17件であること
- `list_skills` の件数が25件以上であること
- `get_context` で `project.md` / `coding-conventions.md` / `environments.md` の3件が返ること
- `context/project.md` にプレースホルダー `（カスタムオブジェクト名）__c` が残っていないこと

---

### 2-2. プロンプト生成の基本確認（`chat`）

**検証手順**

```
chat({
  topic: "Apex トリガーの実装レビュー",
  agents: ["apex-developer", "qa-engineer"],
  skills: ["apex/apex-best-practices"]
})
```

**確認観点（プロンプトの内容を目視確認）**

| 確認項目 | 期待値 |
|---|---|
| `## プロジェクトコンテキスト` セクションが存在する | context/ の内容が注入されている |
| `## 参加エージェント定義` が存在する | apex-developer / qa-engineer の定義が含まれる |
| `## 適用スキル` が存在する | apex-best-practices の内容が含まれる |
| `## ディスカッション規約` が存在する | discussion-framework.md の内容が含まれる |
| `## レビューモード` が存在する | topic に「レビュー」を含むため自動挿入される |
| `## タスク` の発言形式ルール | `**agent-name**: 発言内容` のルールが記載されている |
| filePaths 未指定のため `## コードコンテキスト` が存在しない | セクションなし |
| filePaths 未指定のため `## レビュー観点` が存在しない | セクションなし |

---

### 2-3. レビューモードの確認（`chat` with `filePaths`）

**検証手順**

```
chat({
  topic: "AccountService.cls のコードレビュー",
  agents: ["apex-developer", "security-engineer"],
  filePaths: ["path/to/AccountService.cls"]
})
```

**確認観点**

| 確認項目 | 期待値 |
|---|---|
| `## コードコンテキスト` が存在する | ファイル内容がコードブロックで含まれる |
| `## レビュー観点` が存在する | review-framework.md の5観点が含まれる |
| `## レビューモード` が存在する | filePaths あり + topic に「レビュー」含む |

---

### 2-4. スキル自動選択の確認

**検証手順**

```
chat({
  topic: "SOQL の最適化",
  agents: ["apex-developer"]
  // skills を未指定
})
```

**確認観点**

- `## 適用スキル` セクションが存在する（自動選択されている）
- `apex/apex-best-practices` または `performance/governor-limits` が選ばれていること
- トピックと無関係なスキルが選ばれていないこと

---

### 2-5. オーケストレーションフローの確認

**検証手順（シーケンス順）**

```
1. orchestrate_chat({
     topic: "Apex バッチ処理の設計",
     agents: ["architect", "apex-developer", "qa-engineer"],
     triggerRules: [
       { whenAgent: "architect", thenAgent: "apex-developer", messageIncludes: "実装", reason: "実装観点へ" },
       { whenAgent: "apex-developer", thenAgent: "qa-engineer", messageIncludes: "クラス", reason: "テスト観点へ" }
     ]
   })
   → sessionId を控えておく

2. get_orchestration_session({ sessionId })
   → queue に ["architect", "apex-developer", "qa-engineer"] が入っていること

3. dequeue_next_agent({ sessionId })
   → dequeued: ["architect"]

4. evaluate_triggers({
     sessionId,
     lastAgent: "architect",
     lastMessage: "この設計で実装を進めましょう"  // "実装" を含む
   })
   → nextAgents: ["apex-developer"] であること（triggerRule にマッチ）

5. evaluate_triggers({
     sessionId,
     lastAgent: "architect",
     lastMessage: "問題ありません"  // "実装" を含まない
   })
   → usedRoundRobinFallback: true であること（ルール不一致でラウンドロビン）
```

**確認観点**

| 手順 | 期待値 |
|---|---|
| 手順1 | sessionId が返り、prompt にすべてのエージェント定義が含まれる |
| 手順2 | queue に3エージェントが入っている |
| 手順3 | dequeued: ["architect"]、remainingQueue に残り2件 |
| 手順4 | triggerRule にマッチして apex-developer が返る |
| 手順5 | ラウンドロビンフォールバックが動作する |

---

### 2-6. ガバナンス・リソース管理の確認

**検証手順**

```
1. get_resource_governance()
   → counts, config, disabled を確認

2. apply_resource_actions({
     actions: [{ resourceType: "skills", action: "create", name: "test-skill-verify", content: "# テスト\n\n## 概要\nテスト用スキル" }]
   })
   → created が返ること

3. list_skills()
   → test-skill-verify が含まれること

4. apply_resource_actions({
     actions: [{ resourceType: "skills", action: "disable", name: "test-skill-verify" }]
   })
   → disabled が返ること

5. get_resource_governance()
   → disabled.skills に test-skill-verify が含まれること

6. apply_resource_actions({
     actions: [{ resourceType: "skills", action: "delete", name: "test-skill-verify" }]
   })
   → deleted が返ること
```

**確認観点**

- 品質チェック: 名前が1文字の場合は `quality_check_failed` が返ること
- 重複チェック: 既存スキルと同名を作ろうとすると `quality_check_failed` が返ること
- 日次制限: 6回以上 create しようとすると `daily_limit_exceeded` が返ること

---

### 2-7. イベント自動無効化の確認

**検証手順**

```
1. get_event_automation_config()
   → autoDisableTool: true であること

2. get_agent({ name: "存在しないエージェント名" }) を3回繰り返す
   → 3回目以降でエラーになること

3. get_system_events({ event: "error_aggregate_detected", limit: 5 })
   → get_agent に関するイベントが記録されていること
   → payload.automation.action が "disable-tool" であること

4. get_resource_governance()
   → disabled.tools に "get_agent" が含まれること

5. （後片付け）apply_resource_actions で get_agent を enable に戻す
```

---

### 2-8. メモリ系ツールの確認

**検証手順**

```
1. add_memory({ text: "Apex 設計パターンの議事録: Service レイヤーに集約する方針" })
2. add_memory({ text: "LWC コンポーネント間通信は LMS を使用する" })
3. search_memory({ query: "Apex" }) → 1件ヒットすること
4. list_memory() → 2件返ること
5. clear_memory() → "Memory cleared." が返ること
6. list_memory() → 0件であること
```

---

### 2-9. `run_preset` の確認

**検証手順**

```
1. list_presets() → 7件のプリセットが表示されること

2. run_preset({ name: "Salesforce 開発レビュー" })
   → プロンプトが返ること
   → architect / apex-developer / lwc-developer / qa-engineer の定義が含まれること

3. run_preset({
     name: "Salesforce 開発レビュー",
     overrideAgents: ["security-engineer"],
     additionalSkills: ["security/secure-apex"]
   })
   → architect ではなく security-engineer の定義が含まれること
   → apex/apex-best-practices + security/secure-apex の両方が含まれること

4. run_preset({ name: "存在しないプリセット名" })
   → "Preset not found" が返ること
```

---

## 3. プロンプト品質検証

実際に LLM にプロンプトを渡して回答の質を評価する。

### 3-1. エージェント発言スタイルの確認

**検証方法**

`chat` で生成したプロンプトを Claude に渡して会話を実行する。

**確認観点**

| 観点 | 確認内容 |
|---|---|
| 発言形式 | `**agent-name**: 発言内容` の形式で各エージェントが発言しているか |
| 役割の遵守 | apex-developer が UI の判断をしていないか（禁止事項が機能しているか） |
| 専門性 | apex-developer が governor limit の数値（SOQL 100件等）を正確に使っているか |
| ディスカッション規約 | 各発言が「立場表明 → 根拠 → 懸念点 → 提案」の構造になっているか |
| 会話の締め方 | 「誰が・何を・いつまでに」の形式でアクションが示されているか |

### 3-2. レビュー品質の確認

**検証方法**

意図的にセキュリティ問題（CRUD/FLS 未チェック・without sharing 等）を含む Apex コードを `filePaths` に渡して `chat` を実行する。

**確認観点**

| 観点 | 確認内容 |
|---|---|
| 重大度 A 検出 | セキュリティ問題が「重大度A（即修正）」として指摘されるか |
| 具体的な修正案 | `isAccessible()` / `stripInaccessible()` を使った修正コードが示されるか |
| review-framework の5観点網羅 | 正確性・セキュリティ・パフォーマンス・テスタビリティ・デプロイ可能性が確認されるか |
| 総合判定 | `APPROVE` / `REQUEST_CHANGES` / `NEEDS_DISCUSSION` のいずれかで締めくくられるか |

### 3-3. context/ の有効性確認

**検証方法**

`context/project.md` に実際のプロジェクト情報（カスタムオブジェクト名・コーディング規約）を記載した状態で `chat` を実行する。

**確認観点**

- エージェントが `context/` に記載したカスタムオブジェクト名を使って回答しているか
- コーディング規約（`SeeAllData=true` 禁止等）に言及しているか
- プロジェクトのアーキテクチャ制約（Trigger → Handler → Service → Selector）を踏まえた設計提案をしているか

---

## 4. 検証チェックリスト

### 基本動作（自動テスト）

- [ ] `npm test` が全件 pass する
- [ ] `server exposes expected core tool registrations` が全57ツールを確認している

### プロンプト生成（手動）

- [ ] `chat` で `## プロジェクトコンテキスト` が注入されている
- [ ] `chat` で `## ディスカッション規約` が常時注入されている
- [ ] topic に「レビュー」を含む場合に `## レビューモード` が注入される
- [ ] filePaths 指定時に `## コードコンテキスト` と `## レビュー観点` が注入される
- [ ] skills 未指定時にスキルが自動選択される（トピックに関連するスキルが選ばれる）
- [ ] maxContextChars 指定時に全セクションが予算内に収まっている

### オーケストレーション（手動）

- [ ] `orchestrate_chat` → `evaluate_triggers` → `dequeue_next_agent` の一連が動作する
- [ ] triggerRules でマッチした場合に指定エージェントが返る
- [ ] マッチしない場合にラウンドロビンが動作する
- [ ] `once: true` のルールが2回目以降スキップされる
- [ ] `save_orchestration_session` → `restore_orchestration_session` でセッションが復元される

### ガバナンス（手動）

- [ ] スキルの作成・無効化・削除が正常に動作する
- [ ] 品質チェック失敗時に作成が中止される
- [ ] 重複検出で類似スキルがある場合に作成が中止される
- [ ] 日次制限（6回目の create）で拒否される
- [ ] ツール自動無効化（3回エラー後）が動作する
- [ ] 無効化されたツールが `govTool` ラッパーでブロックされる

### プリセット（手動）

- [ ] 7件のプリセットが全件 `list_presets` に表示される
- [ ] `run_preset` でプロンプトが正常に返る
- [ ] `overrideAgents` でエージェントが置換される
- [ ] `additionalSkills` でスキルが追加される
- [ ] 存在しないプリセット名で適切なエラーメッセージが返る

### メモリ（手動）

- [ ] `add_memory` → `search_memory` → `list_memory` → `clear_memory` の一連が動作する
- [ ] `search_memory` が部分一致で正しくヒットする
- [ ] `clear_memory` 後に `list_memory` が0件を返す

### エージェント・ペルソナ・スキル（手動）

- [ ] `list_agents` が17件を返す
- [ ] `get_agent` で各エージェントの定義が正しく返る（flow-specialist を含む）
- [ ] `list_skills` が25件以上を返す
- [ ] `list_personas` が15件を返す

### context/ 注入（手動）

- [ ] `get_context` で3ファイルが返る（project.md / coding-conventions.md / environments.md）
- [ ] `context/project.md` にプレースホルダーが残っていない
- [ ] chat プロンプトに `## プロジェクトコンテキスト` が含まれる

---

## 5. 既知の注意事項

### インメモリデータの揮発性

`agentLog` / `orchestrationSessions` / `memory` / `vectorStore` はすべてプロセス再起動でリセットされる。長期的なデータを保持するには以下を実行しておく必要がある。

```
save_chat_history({ topic: "..." })           ← agentLog を永続化
save_orchestration_session({ sessionId })     ← セッションを永続化
```

### `tools` の maxCounts 上限超過

現在のデフォルトは `maxCounts.tools: 150` のため、ビルトインツール数（57件）では上限超過しない。必要に応じて `review_resource_governance` で `updateMaxCounts` を調整する。

### `リリース準備チェック` プリセットの triggerRules 未設定

このプリセットのみ `triggerRules` が未設定のため、`orchestrate_chat` で実行するとラウンドロビンのみになる。意図的な場合は問題ないが、セッションベースの連携が必要な場合は `triggerRules` を追加する。

### `saveChatHistory()` の ID 衝突

1秒以内に複数回 `save_chat_history` を呼ぶと同じ ID になりファイルが上書きされる可能性がある。通常の使用では問題ないが、自動化スクリプトで高頻度呼び出しする場合は注意が必要。
