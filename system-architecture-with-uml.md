# salesforce-ai-company システム構成ドキュメント（UML付き）

> リポジトリ: `D:\Projects\mult-agent-ai\salesforce-ai-company`  
> 作成日: 2026-04-20

---

## 1. システム全体アーキテクチャ

```mermaid
graph TB
    subgraph Client["MCP クライアント（Claude Desktop / VS Code）"]
        USER[ユーザー]
    end

    subgraph Server["mcp/server.ts — MCP サーバー"]
        direction TB
        GOVTOOL["govTool() ラッパー\n（disable チェック + イベント発火）"]
        BCP["buildChatPrompt()\nプロンプト組み立て"]
        TOOLS["57 ツール群"]
    end

    subgraph Content["コンテンツ層（Markdown）"]
        AGENTS["agents/ × 17"]
        SKILLS["skills/ × 25"]
        PERSONAS["personas/ × 15"]
        CONTEXT["context/ × 3\n（全プロンプトに自動注入）"]
        PROMPTENG["prompt-engine/ × 5"]
    end

    subgraph Core["mcp/core/ — コアモジュール"]
        RESOURCE["resource/\nスコアリング・ギャップ検出"]
        QUALITY["quality/\n品質チェック・重複検出"]
        GOVERNANCE["governance/\nガバナンス設定・日次制限"]
        EVENT["event/\nEventDispatcher"]
    end

    subgraph Memory["memory/ — インメモリストア"]
        PMEM["project-memory.ts\n文字列ストア"]
        VSTORE["vector-store.ts\nキーワードレコード"]
    end

    subgraph PromptEngine["prompt-engine/"]
        BUILDER["prompt-builder.ts\n単一エージェント用"]
    end

    subgraph Handlers["mcp/handlers/"]
        AUTOINIT["auto-init.ts\n6ハンドラー自動登録"]
        STATS["statistics-manager.ts\n統計管理"]
    end

    subgraph Outputs["outputs/ — 永続化"]
        PRESETS["presets/*.json"]
        HISTORY["history/*.json"]
        SESSIONS["sessions/*.json"]
        GOVFILE["resource-governance.json"]
        EVTLOG["events/system-events.jsonl"]
        OPSLOG["operations-log.jsonl"]
        CUSTOMTOOLS["custom-tools/*.json"]
    end

    USER -->|MCP プロトコル| GOVTOOL
    GOVTOOL --> TOOLS
    TOOLS --> BCP
    BCP --> AGENTS
    BCP --> SKILLS
    BCP --> PERSONAS
    BCP --> CONTEXT
    BCP --> PROMPTENG
    TOOLS --> Core
    TOOLS --> Memory
    TOOLS --> PromptEngine
    TOOLS --> Outputs
    Core --> EVENT
    EVENT --> Handlers
    Handlers --> STATS
```

---

## 2. プロンプト生成フロー（`buildChatPrompt`）

```mermaid
flowchart TD
    START([呼び出し: topic / agents / skills / filePaths / persona])

    START --> CTX{context/ が存在?}
    CTX -- Yes --> LOAD_CTX["context/ の全 .md を読み込み\n(perItemBudget で truncate)"]
    CTX -- No --> SKIP_CTX[スキップ]

    LOAD_CTX --> BUDGET["totalItems を計算\n= files + agents + skills + persona + contextFiles\nperItemBudget = maxContextChars ÷ totalItems"]
    SKIP_CTX --> BUDGET

    BUDGET --> PARALLEL["Promise.all() で並列読み込み\n① コードファイル\n② エージェント定義\n③ スキル定義\n④ ペルソナ定義"]

    PARALLEL --> S1["## プロジェクトコンテキスト"]
    S1 --> S2{filePaths あり?}
    S2 -- Yes --> S3["## コードコンテキスト"]
    S2 -- No --> S4
    S3 --> S4["## 参加エージェント定義"]
    S4 --> S5{skills あり?}
    S5 -- Yes --> S6["## 適用スキル"]
    S5 -- No --> S7
    S6 --> S7{persona あり?}
    S7 -- Yes --> S8["## ペルソナ"]
    S7 -- No --> S9
    S8 --> S9["## ディスカッション規約\n(discussion-framework.md 常時)"]
    S9 --> S10{filePaths あり?}
    S10 -- Yes --> S11["## レビュー観点\n(review-framework.md)"]
    S10 -- No --> S12
    S11 --> S12{filePaths あり OR topic に\n'レビュー/確認/チェック'?}
    S12 -- Yes --> S13["## レビューモード\n(review-mode.md)"]
    S12 -- No --> S14
    S13 --> S14["## タスク\n(topic + turns + ルール + appendInstruction)"]
    S14 --> END(["\n\n---\n\n" で結合して返す])
```

---

## 3. スキル自動選択フロー

```mermaid
flowchart TD
    CALL["chat() 呼び出し\nskills = 未指定"]
    CALL --> AUTO["suggestSkillsFromTopic(topic, 3)"]
    AUTO --> LIST["listMdFiles('skills')\n全スキルの name + summary を取得"]
    LIST --> SCORE["scoreByQuery(topic, name, summary)\nJaccard + usage + bugSignals でスコア計算"]
    SCORE --> RANK["スコア降順ソート\n上位3件を選択"]
    RANK --> CHECK{overallMax\n>= 閾値(6)?}
    CHECK -- No --> EVT["low_relevance_detected\nイベント発火"]
    CHECK -- Yes --> DISABLED["filterDisabledSkills()\n disabled スキルを除外"]
    EVT --> DISABLED
    DISABLED --> PROMPT["buildChatPrompt() に渡す"]
```

---

## 4. オーケストレーションシーケンス図

```mermaid
sequenceDiagram
    actor User
    participant Server as MCP Server
    participant Session as OrchestrationSession (Memory)
    participant FS as outputs/sessions/

    User->>Server: orchestrate_chat(topic, agents, triggerRules)
    Server->>Server: buildChatPrompt()
    Server->>Session: セッション作成\n{ queue: [...agents], history: [], firedRules: [] }
    Server-->>User: { sessionId, prompt, nextQueue }

    loop 会話ループ（クライアント側）
        User->>Server: dequeue_next_agent(sessionId)
        Server->>Session: queue.shift()
        Server-->>User: { dequeued: ["apex-developer"], remainingQueue }

        Note over User: LLM に発言させる

        User->>Server: evaluate_triggers(sessionId, lastAgent, lastMessage)
        Server->>Session: triggerRules を評価
        alt ルールにマッチ
            Session-->>Server: nextAgents = ["qa-engineer"]
        else マッチなし（fallbackRoundRobin）
            Session-->>Server: nextAgents = [次のエージェント（ラウンドロビン）]
        end
        Server->>Session: history に発言を記録\nfiredRules にキーを追加
        Server->>Server: turn_complete イベント発火
        Server-->>User: { nextAgents, reasons }

        alt キューが空
            Server->>Server: session_end イベント発火
        end
    end

    opt セッション保存
        User->>Server: save_orchestration_session(sessionId)
        Server->>FS: sessions/{sessionId}.json に書き込み
        Server-->>User: { saved: true, filePath }
    end
```

---

## 5. ガバナンス・イベント自動化フロー

```mermaid
flowchart TD
    subgraph TRIGGER["エラー集約検出"]
        FAIL["ツール実行失敗"]
        FAIL --> REGFAIL["registerToolFailure(toolName)"]
        REGFAIL --> WIN{"10分以内に\n3回以上失敗?"}
        WIN -- No --> END1[終了]
        WIN -- Yes --> COOL{"クールダウン\n60秒経過?"}
        COOL -- No --> END1
        COOL -- Yes --> EMIT["error_aggregate_detected\nイベント発火"]
    end

    subgraph AUTOMATION["イベント自動アクション（applyEventAutomation）"]
        EMIT --> ENABLED{"eventAutomation\nenabled?"}
        ENABLED -- No --> END2[スキップ]
        ENABLED -- Yes --> PROTECTED{"保護ツール\n(DEFAULT_PROTECTED)?"}
        PROTECTED -- Yes --> SKIP["action: skip\n(protected-tool)"]
        PROTECTED -- No --> DISABLED2{"既に\ndisabled?"}
        DISABLED2 -- Yes --> SKIP2["action: skip\n(already-disabled)"]
        DISABLED2 -- No --> DISABLE["setToolDisabledState(true)\nガバナンス状態に記録"]
        DISABLE --> CACHE["refreshDisabledToolsCache()\nメモリ Set を更新"]
        CACHE --> BLOCK["次回 govTool で\nツールブロック"]
    end
```

---

## 6. リソース作成フロー（`apply_resource_actions` の create）

```mermaid
flowchart TD
    INPUT["apply_resource_actions\n{ action: 'create', resourceType, name, content }"]
    INPUT --> LIMIT{"日次制限チェック\ncheckDailyLimitExceeded()"}
    LIMIT -- 超過 --> ERR1["daily_limit_exceeded で中止"]
    LIMIT -- OK --> MAXCHECK{"maxCounts 超過?"}
    MAXCHECK -- 超過 --> ERR2["max reached で中止"]
    MAXCHECK -- OK --> DUP{"重複チェック\ncheckForDuplicates()\n類似度 >= 0.8?"}
    DUP -- 重複あり --> ERR3["quality_check_failed\n(類似リソース存在)"]
    DUP -- 重複なし --> QUAL{"品質チェック\ncheckResourceQuality()\npass?"}
    QUAL -- fail --> ERR4["quality_check_failed\n(品質基準未達)"]
    QUAL -- pass --> WRITE["ファイルに書き込み\n(skill .md / preset .json / tool .json)"]
    WRITE --> EVT1["resource_created イベント発火"]
    WRITE --> LOG["operations-log.jsonl に記録"]
    ERR3 --> EVT2["quality_check_failed イベント発火"]
    ERR4 --> EVT2
```

---

## 7. クラス関係図（主要インターフェース）

```mermaid
classDiagram
    class GovernanceState {
        +config: GovernanceConfig
        +usage: Record~ResourceType, Record~string, number~~
        +bugSignals: Record~ResourceType, Record~string, number~~
        +disabled: Record~ResourceType, string[]~
        +updatedAt: string
    }

    class GovernanceConfig {
        +maxCounts: MaxCounts
        +thresholds: Thresholds
        +resourceLimits: ResourceLimits
        +eventAutomation: EventAutomation
    }

    class MaxCounts {
        +skills: number
        +tools: number
        +presets: number
    }

    class ResourceLimits {
        +creationsPerDay: number
        +deletionsPerDay: number
    }

    class OrchestrationSession {
        +id: string
        +topic: string
        +agents: string[]
        +skills: string[]
        +filePaths: string[]
        +turns: number
        +triggerRules: TriggerRule[]
        +queue: string[]
        +history: AgentMessage[]
        +firedRules: string[]
    }

    class TriggerRule {
        +whenAgent: string
        +thenAgent: string
        +messageIncludes?: string
        +reason?: string
        +once?: boolean
    }

    class AgentMessage {
        +agent: string
        +message: string
        +timestamp: string
        +topic?: string
    }

    class ChatPreset {
        +name: string
        +description: string
        +topic: string
        +agents: string[]
        +skills: string[]
        +persona?: string
        +filePaths?: string[]
        +triggerRules?: TriggerRule[]
    }

    class CustomToolDefinition {
        +name: string
        +description: string
        +agents: string[]
        +skills: string[]
        +persona?: string
        +createdAt: string
    }

    class QualityCheckResult {
        +pass: boolean
        +score: number
        +errors: QualityError[]
        +warnings: QualityWarning[]
    }

    GovernanceState --> GovernanceConfig
    GovernanceConfig --> MaxCounts
    GovernanceConfig --> ResourceLimits
    OrchestrationSession --> TriggerRule
    OrchestrationSession --> AgentMessage
    ChatPreset --> TriggerRule
```

---

## 8. イベントシステムのシーケンス（ブリッジ構造）

```mermaid
sequenceDiagram
    participant Tool as govTool ラッパー
    participant SES as emitSystemEvent()
    participant AUTO as applyEventAutomation()
    participant LOG as system-events.jsonl
    participant MEM as recentSystemEvents[]
    participant BRIDGE as emitEvent() (core EventDispatcher)
    participant HANDLER as auto-init ハンドラー

    Tool->>SES: emitSystemEvent("error_aggregate_detected", payload)
    SES->>AUTO: applyEventAutomation() でツール自動無効化
    AUTO-->>SES: payload.automation に結果を付記
    SES->>MEM: recentSystemEvents に push (上限200件)
    SES->>LOG: system-events.jsonl に追記
    alt event が error_aggregate_detected または governance_threshold_exceeded
        SES->>BRIDGE: emitEvent({ type, timestamp, payload })
        BRIDGE->>HANDLER: error_aggregator ハンドラー起動
        HANDLER-->>HANDLER: handlersState.errorTracker をインクリメント
    end
```

---

## 9. ファイル構成図

```
salesforce-ai-company/
├── mcp/
│   ├── server.ts                    ← 全ツール登録・buildChatPrompt・ガバナンス管理
│   ├── tools/
│   │   ├── apex-analyzer.ts         ← 9項目静的チェック
│   │   ├── lwc-analyzer.ts          ← 7項目静的チェック
│   │   ├── deploy-org.ts            ← sf CLI コマンド生成
│   │   ├── run-tests.ts             ← Apex テストコマンド生成
│   │   ├── branch-diff-summary.ts   ← git diff 集計
│   │   ├── branch-diff-to-prompt.ts ← diff → プロンプト変換
│   │   ├── pr-readiness-check.ts    ← PR 準備スコア
│   │   ├── security-delta-scan.ts   ← セキュリティ差分検出
│   │   ├── deployment-impact-summary.ts
│   │   └── changed-tests-suggest.ts
│   ├── core/
│   │   ├── resource/
│   │   │   ├── resource-selector.ts     ← scoreCandidate() スコアリング
│   │   │   ├── resource-gap-detector.ts ← ギャップ検出
│   │   │   └── resource-suggester.ts    ← リソース提案
│   │   ├── quality/
│   │   │   ├── quality-checker.ts   ← スキル/ツール/プリセット品質チェック
│   │   │   └── deduplication.ts     ← Jaccard 類似度重複検出
│   │   ├── governance/
│   │   │   └── governance-manager.ts ← GovernanceConfig・日次制限・スコア計算
│   │   └── event/
│   │       └── event-dispatcher.ts  ← EventDispatcher (onEvent / emitEvent)
│   └── handlers/
│       ├── auto-init.ts             ← 6ハンドラー自動登録・HandlersState
│       └── statistics-manager.ts   ← CSV/JSON エクスポート
├── memory/
│   ├── project-memory.ts            ← memory[] 配列 (add/search/list/clear)
│   └── vector-store.ts             ← records[] 配列 (addRecord/searchByKeyword)
├── prompt-engine/
│   ├── prompt-builder.ts           ← buildPrompt(agent, task)
│   ├── base-prompt.md
│   ├── reasoning-framework.md
│   ├── discussion-framework.md
│   ├── review-framework.md
│   └── review-mode.md
├── agents/       (17 .md)
├── skills/       (25 .md)
├── personas/     (15 .md)
├── context/      (3 .md ← 全プロンプトに自動注入)
├── outputs/
│   ├── presets/          (7 .json)
│   ├── history/          (.json 都度生成)
│   ├── sessions/         (.json 都度生成)
│   ├── custom-tools/     (.json 動的生成)
│   ├── resource-governance.json
│   ├── system-events.jsonl
│   └── operations-log.jsonl
└── tests/
    ├── server-tools.integration.test.ts  ← ツール登録確認 + E2E
    ├── core-tools.test.ts
    ├── advanced-tools.test.ts
    ├── branch-diff-tools.test.ts
    ├── apply-resource-actions.test.ts
    ├── core-modules.test.ts
    ├── handlers-modules.test.ts
    └── memory-prompt.test.ts
```

---

## 10. ツール分類一覧（55ツール）

### 静的解析・コマンド生成（11）

| ツール名 | 概要 |
|---|---|
| `repo_analyze` | Apex/LWC/Object のファイル一覧を返す |
| `apex_analyze` | Apex 9項目静的チェック（SOQL in loop / DML in loop / without sharing 等） |
| `lwc_analyze` | LWC 7項目静的チェック（@wire / @api / imperative / NavigationMixin 等） |
| `deploy_org` | `sf project deploy start` コマンドを組み立てて返す |
| `run_tests` | `sf apex run test` コマンドを組み立てて返す |
| `branch_diff_summary` | ブランチ差分のファイル変更サマリー |
| `branch_diff_to_prompt` | ブランチ差分からレビュー用プロンプトを生成 |
| `pr_readiness_check` | PR 準備スコアと ready/needs-review/blocked ゲート |
| `security_delta_scan` | 差分から CRUD/FLS/sharing/動的 SOQL 懸念を検出 |
| `deployment_impact_summary` | 差分をメタデータ種別に集計してデプロイ注意点を返す |
| `changed_tests_suggest` | 差分から推奨テストクラスと実行コマンドを返す |

### 定義参照（5）

| ツール名 | 概要 |
|---|---|
| `list_agents` | 全エージェント一覧（name + summary） |
| `get_agent` | 特定エージェントの Markdown 全文 |
| `list_skills` | 全スキル一覧（name + summary） |
| `get_skill` | 特定スキルの Markdown 全文 |
| `list_personas` | 全ペルソナ一覧（name + summary） |

### 会話生成（6）

| ツール名 | 概要 |
|---|---|
| `chat` | マルチエージェントプロンプト生成（メイン） |
| `simulate_chat` | `chat` の互換エイリアス |
| `smart_chat` | リポジトリ自動分析 + ファイル自動選択して `chat` 実行 |
| `batch_chat` | 複数トピック一括処理（topicConfigs / parallel 対応） |
| `build_prompt` | 単一エージェント用軽量プロンプト（base + reasoning のみ） |
| `get_context` | context/ の内容確認（プロンプトに何が注入されているか） |

### オーケストレーション（7）

| ツール名 | 概要 |
|---|---|
| `orchestrate_chat` | triggerRules 付きセッション開始 |
| `evaluate_triggers` | 発言に対してルール評価し次エージェントを返す |
| `dequeue_next_agent` | キューから次エージェントを取り出す |
| `get_orchestration_session` | セッション状態確認 |
| `save_orchestration_session` | セッションをファイルに保存 |
| `restore_orchestration_session` | 保存済みセッションを復元 |
| `list_orchestration_sessions` | 保存済みセッション一覧 |

### ログ・履歴（7）

| ツール名 | 概要 |
|---|---|
| `record_agent_message` | エージェントメッセージを手動記録 |
| `get_agent_log` | ログ取得（エージェント名・件数フィルタ） |
| `parse_and_record_chat` | `**agent**: message` 形式を解析してログに記録 |
| `save_chat_history` | 現在のログを JSON 保存 |
| `load_chat_history` | 保存済み履歴一覧 |
| `restore_chat_history` | 保存済み履歴をログに復元 |
| `export_to_markdown` | チャット履歴を Markdown エクスポート（ファイル出力可） |

### プリセット・検索（5）

| ツール名 | 概要 |
|---|---|
| `create_preset` | プリセット作成（triggerRules 対応） |
| `list_presets` | プリセット一覧 |
| `run_preset` | プリセット実行（overrideAgents / additionalSkills 対応） |
| `search_resources` | スキル/ツール/プリセット横断検索（スコア付き） |
| `auto_select_resources` | トピックから最適リソースを自動選択 |

### 分析・統計（4）

| ツール名 | 概要 |
|---|---|
| `analyze_chat_trends` | ログ傾向分析（historyId / since / groupBy） |
| `get_handlers_dashboard` | ハンドラー稼働統計 |
| `export_handlers_statistics` | ハンドラー統計を JSON/CSV エクスポート |
| `get_system_events` | システムイベントログ取得 |

### イベント自動化設定（2）

| ツール名 | 概要 |
|---|---|
| `get_event_automation_config` | イベント自動アクション設定を返す |
| `update_event_automation_config` | イベント自動アクション設定を更新 |

### ガバナンス（4）

| ツール名 | 概要 |
|---|---|
| `get_resource_governance` | ガバナンス状態（カウント/usage/bugSignals/disabled） |
| `record_resource_signal` | usage と bugSignal を記録 |
| `review_resource_governance` | 整理推奨リストを返す（設定変更も可） |
| `apply_resource_actions` | スキル/ツール/プリセットの作成/削除/無効化/有効化 |

### メモリ・ベクターストア（6）

| ツール名 | 概要 |
|---|---|
| `add_memory` | テキストをインメモリ記録 |
| `search_memory` | 部分一致検索 |
| `list_memory` | 全記録を返す |
| `clear_memory` | 全削除 |
| `add_vector_record` | id/text/tags でレコード追加 |
| `search_vector` | キーワード検索 |



## 11. スコアリングロジック

```
score = nameMatch + tagMatch + descriptionMatch + usageBonus - bugPenalty + recencyBonus

nameMatch:   完全一致 +30 / 含む +12 / トークン部分一致 +4/件
tagMatch:    +8/マッチタグ
descMatch:   含む +6 / トークン部分一致 +3/件
usageBonus:  log(usage + 1) × 0.5
bugPenalty:  bugSignals × 3
recBonus:    7日以内の更新で最大 +5

低関連度閾値: 6（未満で low_relevance_detected イベント発火）
```

---

## 12. データ永続化マップ

| データ | 形式 | パス | 揮発性 |
|---|---|---|---|
| チャット履歴 | JSON | `outputs/history/{id}.json` | 永続 |
| オーケストレーションセッション（保存済み） | JSON | `outputs/sessions/{id}.json` | 永続 |
| システムイベントログ | JSONL | `outputs/events/system-events.jsonl` | 永続 |
| 操作ログ（日次制限用） | JSONL | `outputs/operations-log.jsonl` | 永続 |
| ガバナンス状態 | JSON | `outputs/resource-governance.json` | 永続 |
| カスタムツール定義 | JSON | `outputs/custom-tools/{name}.json` | 永続 |
| プリセット | JSON | `outputs/presets/{name}.json` | 永続 |
| エージェントログ（agentLog） | メモリ配列 | — | **揮発** |
| オーケストレーションセッション（Map） | メモリ Map | — | **揮発**（save で永続化可） |
| インメモリ文字列ストア | メモリ配列 | — | **揮発** |
| ベクターストア | メモリ配列 | — | **揮発** |
| disabled ツールキャッシュ | メモリ Set | — | **揮発**（起動時/操作後に再構築） |
| システムイベント（直近200件） | メモリ配列 | — | **揮発**（上限超過で古い順削除） |
