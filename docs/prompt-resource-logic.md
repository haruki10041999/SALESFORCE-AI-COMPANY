# プロンプト / リソース / 自動選択ロジック 詳細

---

## 1. プロンプト生成ロジック (`prompt-engine/`)

### 1-1. エントリポイント: `buildPrompt()`

```
prompt-engine/prompt-builder.ts → buildPrompt(agent, task, options)
```

**処理フロー**

```
① base-prompt.md を読み込む（全呼び出し共通のシステム指示）
② reasoning-framework.md を読み込む（推論フレームワーク）
③ selectReasoningStrategy(task) で戦略を選択
④ renderPromptTemplate() で Mustache 形式の変数を展開
⑤ 完成プロンプトを返す
```

### 1-2. 推論戦略の自動選択

| 判定条件（正規表現） | 選択される戦略 | 内容 |
|---|---|---|
| `compare\|trade-off\|alternative\|選択肢\|比較\|複数案` | `tree-of-thought` | 2 つ以上の選択肢を比較して選択 |
| `review\|debug\|fix\|improve\|検証\|レビュー\|改善\|振り返り` | `reflect` | 初期回答 → 自己批判 → 改善 |
| それ以外 | `plan` | 手順分解 → 依存整理 → 実行順 |

`options.strategy = "auto"` または未指定の場合はタスクテキストから自動判定。

### 1-3. プロンプトテンプレート構造

```
{{base}}          ← base-prompt.md の内容
Agent
{{agent.name}}
{{agent.content}} ← agents/*.md の内容
Task
{{task}}
{{reasoning}}     ← reasoning-framework.md の内容
ReasoningStrategy
{{strategyName}}
{{strategyGuidance}}
```

### 1-4. コンテキスト予算配分 (`core/context/context-budget.ts`)

各カテゴリへの文字数割り当てを **重み付き配分** で行う。

| カテゴリ | デフォルト重み |
|---|---|
| agent | 0.30 |
| skill | 0.25 |
| context | 0.20 |
| code | 0.15 |
| persona | 0.05 |
| framework | 0.05 |

アイテムが存在しないカテゴリの配分は他のカテゴリへ再配分される。

---

## 2. リソースのスコアリングロジック (`core/resource/resource-selector.ts`)

### 2-1. スコア計算式

```
score = nameMatch + tagMatch + descriptionMatch + usageScore - bugPenalty + recencyBonus
```

| 要素 | デフォルト重み | 説明 |
|---|---|---|
| `exactNameMatch` | 30 | クエリとリソース名が完全一致 |
| `nameContain` | 12 | リソース名にクエリが含まれる |
| `tokenMatch` | 4 | トークン単位で部分一致 |
| `tagMatch` | 8 | タグにクエリトークンが含まれる |
| `descriptionMatch` | 6 | 説明文にクエリが含まれる |
| `usageScore` | ×0.5 | 使用回数 × 0.5（緩やかなスケール） |
| `bugPenalty` | ×3 | バグシグナル数 × 3 を減点 |
| `recencyBonus` | 5 | 作成から 7 日以内なら +5 |

### 2-2. リソース種別ごとの設定

| 種別 | 特徴 |
|---|---|
| skills | 標準設定 |
| tools | exactName -4 / bugPenalty +2 → 信頼性重視 |
| presets | exactName +6 / recency 弱め → 安定運用重視 |

### 2-3. Embedding Hybrid モード（TASK-042）

`embeddingMode: "hybrid"` が設定された場合：

```
hybridScore = α × (tokenScore / tokenScoreScale) + (1-α) × cosineSimilarity
```

- **embedding 手法**: 文字 bigram + trigram の TF ベクトル
- **コサイン類似度** でクエリとリソース説明文を比較
- `α = 0.6`（デフォルト）：token 60% + embedding 40%
- 表記ゆれ・同義語・部分一致への耐性が向上
- 将来的に OpenAI / sentence-transformers へ差し替え可能な設計

### 2-4. QueryIntent によるスコア重みの動的調整

`classifyQueryIntent(query)` が呼ばれると：

1. 7 種類の intent（design / implement / debug / optimize / review / document / deploy）のキーワード辞書と照合
2. 全キーワードマッチ数からスコアを計算し `confidence (0..1)` を返す
3. intent 別の `ScoringConfig` オーバーライドが適用される

---

## 3. 自動選択ロジック (`auto_select_resources` ツール)

### 3-1. 処理フロー

```
① topic を受け取る
② ガバナンス状態 (disabled リスト) をロード
③ ProposalFeedbackModel をロード（過去の採否履歴）
④ QuerySkillIncrementalModel をロード（クエリ→スキルの累積学習）

⑤ [Skills] scoreByQuery(topic, name, summary)
   → withFeedbackScore() でフィードバック補正
   → applyQuerySkillIncrementalScore() で累積学習補正
   → disabled 除外 → score > 0 でフィルタ → 降順ソート → top N

⑥ [Tools] scoreByQuery(topic, name, title, description, ...tags)
   → withFeedbackScore() でフィードバック補正
   → disabled 除外 → score > 0 → 降順ソート → top N

⑦ [Presets] scoreByQuery(topic, name, topic, description, agents.join(" "))
   → withFeedbackScore() でフィードバック補正
   → disabled 除外 → score > 0 → 降順ソート → top N

⑧ confidence 評価（topScore / secondScore の差・比率で high/medium/low 判定）

⑨ overallMax < threshold → low_relevance_detected イベント発火
⑩ confidence.level === "low" → low_confidence_selection イベント発火

⑪ fallback 生成（low confidence 時のみ、clarifyingQuestions 付き）
⑫ 結果を JSON で返す
```

### 3-2. フィードバック補正 (`withFeedbackScore`)

過去に「採用 (approved)」または「却下 (rejected)」された実績を反映。

```
補正後スコア = 基本スコア × (1 + feedbackBonus)
```

### 3-3. 累積学習補正 (`applyQuerySkillIncrementalScore`)

特定のクエリパターンに対してどのスキルが選ばれ続けたかを累積記録し、実績のあるペアのスコアを加算。

### 3-4. Thompson Sampling Bandit (`rl-feedback.ts`)

リソース選択の長期的最適化に使用：

```
各 arm (resource) は Beta(α, β) 分布を保持
  α = 成功回数 + 1
  β = 失敗回数 + 1

select() 時: Beta(α, β) からサンプル → 最大値の arm を選択
forcedExplorationRate: 一定確率で未経験 arm を強制選択（寒冷 arm 解消）
```

フィードバック源：
- `record_skill_rating`: ユーザーの 1-5 評価
- `proposal_feedback`: proposal の approve/reject 結果
- trace 完了シグナル

### 3-5. Confidence 評価基準

| 判定 | 条件 |
|---|---|
| `high` | topScore が十分高く、2 位との差が大きい |
| `medium` | topScore はあるが差が小さい |
| `low` | topScore が低い、または 1 位と 2 位がほぼ同点 |

`low` 判定時はフォールバックとして clarifyingQuestions（3 問）を返却し、`chat` ツールへの誘導を促す。

---

## 4. リソースギャップ検知と自動提案

### 4-1. ギャップ検知 (`resource-gap-detector.ts`)

```
topScore < gapThreshold → gap 検知
severity: low / medium / high
```

### 4-2. 自動提案 (`resource-suggester.ts`)

ギャップが検知されると `resource_gap_detected` イベントが発火され、
`handlers/auto-init.ts` のハンドラーが受信：

```
① gap の severity を評価
② suggestResource() で name / content / priority を生成
③ handlerConfig.autoApply が true (SF_AI_AUTO_APPLY=true) なら即座に適用
④ false の場合は proposal として queue に追加し、人間の承認を待つ
```

---

## 5. エージェント解析ロジック (`agents/`, `core/quality/`)

### 5-1. エージェントメタデータの読み込みと解析

`agents/` フォルダ内の各 Markdown ファイル（例：`apex-developer.md`, `architect.md`）は以下の構造を持ちます：

```markdown
---
tags: [tag1, tag2, ...]
title: Agent Display Name
description: Brief description
---

## Main content
エージェントの定義・期待される役割・専門知識
```

**読み込みフロー**

```
① listMdFiles("agents") で agents/*.md 一覧を取得
② getFrontmatter() で YAML frontmatter をパース（title, description, tags）
③ ファイル本体をプロンプト生成時に使用
④ buildPrompt(agent, task) で agent.content に Markdown 全文を設定
```

### 5-2. エージェント信頼スコア (`core/quality/agent-trust-score.ts`)

エージェント応答の品質を**学習と採否履歴**から評価する仕組み。

**スコア計算式**

```
score = adoptionRate × 0.4 + feedbackScore × 0.3 + contextMatch × 0.3 + synergyBonus
```

| 要素 | 重み | 説明 |
|---|---|---|
| `adoptionRate` | 0.4 | 過去 accepted / rejected の採用率（Laplace smoothing） |
| `feedbackScore` | 0.3 | ユーザーの明示的フィードバック (-1..1 を 0..1 に変換) |
| `contextMatch` | 0.3 | topic とエージェント応答の単語重複度 |
| `synergyBonus` | +0..0.15 | agent × skill の相性加点（TASK-043） |

**計算例**

```
history.accepted = 8, history.rejected = 2
adoptionRate = (8 + 1) / (10 + 2) = 0.75

feedbackSignal = 0.5 (ユーザーが「役に立った」)
feedbackScore = (0.5 + 1) / 2 = 0.75

topic = "Apex パフォーマンス最適化"
message = "Apex パフォーマンス改善のため、..." 
contextMatch = 0.6 (2/3 トークンマッチ)

score = 0.75 × 0.4 + 0.75 × 0.3 + 0.6 × 0.3
      = 0.3 + 0.225 + 0.18
      = 0.705

threshold = 0.6 → score > threshold → OK ✓
```

### 5-3. Agent × Skill Synergy モデル (`core/resource/synergy-model.ts`)

過去の **trace 記録** から、どのエージェント + スキル組み合わせが成功しやすいかを学習。

**Synergy スコア計算**

```
synergy_score = (successCount + 1) / (totalCount + 2)  [Laplace 平滑化]
              × log(totalCount + 1)                      [共起度の重み]
```

**例**

| Agent | Skill | Count | Success | Success Rate | Synergy |
|---|---|---|---|---|---|
| apex-developer | apex-optimization | 12 | 11 | 0.923 | 高 |
| apex-developer | lwc-validation | 3 | 1 | 0.4 | 低 |
| architect | design-pattern | 8 | 8 | 0.9 | 高 |

この synergy スコア (0..1) は以下で活用される：

1. **リソース선택時の加점**: `auto_select_resources` で関連スキル候補をランキング時に top スコアに加算
2. **エージェント信頼スコアへの加点**: `evaluateAgentTrust()` で synergyBonus として最大 +0.15
3. **Orchestration のパス選択**: 複数エージェントから次のステップを決めるときに synergy 高いペアを優先

---

## 6. 記録内容と管理 (`outputs/`, `core/event/`)

### 6-1. 記録される情報の種類と保存先

| 記録種別 | ファイル | 内容 | 頻度 |
|---|---|---|---|
| **Chat 履歴** | `outputs/history/YYYY-MM-DD/<historyId>.json` | ユーザー質問 + エージェント応答 + 選択リソース | 毎 chat 実行 |
| **Trace ログ** | `outputs/events/trace-log.jsonl` | input/plan/execute/render フェーズの計測 | 毎 tool 実行 |
| **System Events** | `outputs/events/system-events.jsonl` | session_start / turn_complete / threshold_exceeded など | イベント発火時 |
| **Orchestration セッション** | `outputs/sessions/<sessionId>.json` | オーケストレーション実行時の state / agents queue / 履歴 | session 作成・更新時 |
| **Proposal 記録** | `outputs/tool-proposals/{pending,approved,rejected}/` | リソース自動作成提案と採否 | proposal 生成時 |
| **Agent 信頼履歴** | `outputs/agent-trust-histories.json` | 各エージェントの accepted/rejected 累計 | agent 実行後 |
| **Skill 評価** | `outputs/reports/skill-rating/*.json` | ユーザーの 1-5 スター評価・trend 分析 | rating 記録時 |
| **Governance 状態** | `outputs/resource-governance.json` | disable リスト、quota 使用量、threshold 設定 | 状態変更時 |
| **ベクトルストア** | `outputs/vector-store.jsonl` | memory 内容の embedding + 全文検索用インデックス | memory 追加時 |
| **メトリクス サンプル** | `outputs/events/metrics-samples.jsonl` | 応答時間・トークン数・エラー率の時系列 | 定期的に記録 |

### 6-2. 記録フロー（詳細）

```
turn 実行中
  ├─ turn_complete イベント → system-events.jsonl に記録
  ├─ auto_select_resources → agent-trust-histories.json を参照・更新
  ├─ agent × skill trace → synergy-model 재계산
  ├─ chat 履歴 → history/<date>/<id>.json に保存
  └─ trace 計測情報 → trace-log.jsonl に append

proposal_feedback イベント
  └─ 승인/거부 → agent-trust-histories.json + proposal feedback model 갱신

record_skill_rating 호출
  └─ 평가 → skill-rating 모델 + bandit state 갱신
```

### 6-3. 記録の読み取り方法

#### Chat 履歴の読み取り

```typescript
// 指定日時のチャット一覧を取得
const historyId = "chat-20260428-abc123";
const historyPath = `outputs/history/2026-04-28/${historyId}.json`;
const history: ChatHistory = await fsPromises.readFile(historyPath, "utf-8")
  .then(JSON.parse);

// 含まれる情報
history.turns[0] = {
  topic: "Apex パフォーマンス",
  selectedAgents: ["apex-developer", "performance-engineer"],
  selectedSkills: ["apex-optimization"],
  userMessage: "...",
  assistantResponse: "...",
  timestamp: "2026-04-28T10:30:00Z"
}
```

#### Trace ログの検索

```typescript
// 全 trace を読み込み
const traces = await readTraceLogs();  // JSONL を行ごとにパース

// フィルタ: "apex-developer" で成功した trace を検索
const apexSuccessTraces = traces
  .filter(t => t.agent === "apex-developer" && t.status === "succeeded")
  .slice(0, 100);
```

#### Synergy 情報の活用

```typescript
// synergy model を再構築
const traceRecords = traces.map(t => ({
  agent: t.agent,
  skill: t.skill,
  success: t.status === "succeeded",
  endedAt: t.endedAt
}));
const synergyModel = buildSynergyModel(traceRecords);

// 「apex-developer × apex-optimization」の synergy を取得
const synergy = synergyModel.pairs.get("apex-developer::apex-optimization");
console.log(`synergy=${synergy?.synergyScore}`);  // 0..1
```

---

## 7. フィードバックループでの記録活用

### 7-1. リソース選択精度の継続改善

```
① ユーザーが chat を実行
   → auto_select_resources で top 3 skills, tools, presets を推薦

② エージェント実行結果をユーザーが評価
   ├─ approve_proposal → proposal feedback model に +1
   ├─ reject_proposal → proposal feedback model に -1
   └─ record_skill_rating(skill, 1-5) → bandit state を更新

③ 次回 auto_select_resources 実行時
   → withFeedbackScore() で過去 feedback を反映
   → 評価の高いリソースのスコアが上昇、低いリソースが下降
```

### 7-2. エージェント信頼スコアの動的更新

```
① 初回エージェント実行
   history.accepted = 0, history.rejected = 0
   → adoptionRate = 0.5 (中立的)

② ユーザーが「このエージェントの応答は参考になった」と記録
   → history.accepted += 1

③ 同じエージェントで次のクエリ
   → evaluateAgentTrust() が新しい adoptionRate (>0.5) で計算
   → score が上昇 → next turn で選ばれやすくなる
```

### 7-3. Thompson Sampling による探索/活用

```
記録されたフィードバック (success/failure) から bandit arm を更新：

recordFeedback(state, {
  name: "apex-optimization",
  reward: true,  // ユーザーが approve
  weight: 1.0    // 完全な成功
})
→ arm.alpha += 1.0, arm.beta += 0 (失敗なし)
→ Beta 分布の形が「成功寄り」に更新

次の select() 時：
→ Beta(arm.alpha, arm.beta) からサンプル
→ 成功率が高い arm がより多く選ばれやすくなる

ただし forcedExplorationRate=0.1 設定なら：
→ 10% の確率で「未経験」arm を強制選択
→ コールドリソース（新規作成 skill など）も試す機会が確保される
```

### 7-4. Synergy による組み合わせ最適化

```
trace から synergy を学習し続けることで：

① 「architect × design-pattern」がよく成功 → synergy 高↑
   → 「設計レビュー」クエリでこのペアを優先推薦

② 「apex-developer × lwc-validation」がよく失敗 → synergy 低↓
   → 「LWC バリデーション」クエリではこのペアを避ける

こうした「隠れた」相性データが蓄積され、
自動選択ロジックが時間とともに より正確になる。
```

### 7-5. 記録の利用例：ダッシュボード

`outputs/dashboards/` に HTML/Markdown として定期生成される observability ダッシュボードには：

- **agent 信頼スコアの推移**: 過去 7 日間の avg score 折れ線グラフ
- **synergy heatmap**: agent × skill マトリクスで成功率を色分け表示
- **proposal feedback 分布**: approve / reject / pending の件数
- **bandit arm の試行履歴**: arm 別の成功率・試行回数
- **低 confidence 選択の発生箇所**: clarifyingQuestions が出現したクエリ分布

これらを定期的に確認することで、
どのリソース・組み合わせが実際に機能しているかが可視化される。

---

## 8. クエリ → スキル 累積学習モデル

### 8-1. 概要（TASK-047）

特定のクエリパターンがどのスキルで成功したかを継続的に記録し、次回同じクエリパターンが現れたときにそのスキルを優先推薦する仕組み。

**学習フロー**

```
① ユーザーが chat で topic = "Apex バッチ処理最適化" を入力
② auto_select_resources で "apex-optimization" スキルが選ばれて成功
③ ユーザーが approve_proposal で approval
④ QuerySkillIncrementalModel に entry を append：
   { query: "Apex バッチ処理最適化", skill: "apex-optimization", decision: "accepted", ... }

⑤ 同じ topic が次に出現したとき
⑥ applyQuerySkillIncrementalScore() が記録済みペアのスコアを加算
⑦ "apex-optimization" が再度推薦される確率が上昇
```

### 8-2. モデル構造

```typescript
QuerySkillIncrementalModel = {
  modelVersion: "query-skill-v1",
  updatedAt: "2026-04-28T15:30:00Z",
  totals: {
    accepted: 245,    // 累計承認件数
    rejected: 32,     // 累計却下件数
    total: 277
  },
  skills: [
    {
      skill: "apex-optimization",
      accepted: 45,
      rejected: 2,
      total: 47,
      bias: 0.87,    // (accepted + 1) / (total + 2) で計算
      tokenWeights: {
        "apex": 0.95,
        "最適化": 0.88,
        "バッチ": 0.72,
        ...
      }
    },
    ...
  ]
}
```

### 8-3. スコア加算メカニズム

```
基本スコア（token-based） = 例 10.5

クエリトークン = ["apex", "バッチ", "処理", "最適化"]

tokenWeights から該当トークンの重みを取得：
  "apex" → 0.95
  "バッチ" → 0.72
  その他 → 0 （未記録）

加算スコア = Σ(該当 token weight × 3)
           = (0.95 + 0.72) × 3 = 5.01

最終スコア = 基本スコア + 加算スコア
          = 10.5 + 5.01 = 15.51
```

---

## 9. Proposal Feedback モデル（リソース提案採否学習）

### 9-1. 概要

`suggest_resource` → `approve_proposal` / `reject_proposal` のサイクルから、
どのリソースが実際に受け入れられているかを学習。

**記録される情報**

```typescript
ProposalFeedbackEntry = {
  resourceType: "skills" | "tools" | "presets",
  name: "apex-optimization",
  decision: "accepted" | "rejected" | "reject_inaccurate" | "reject_unnecessary" | "reject_duplicate",
  topic: "Apex パフォーマンス",
  note: "ユーザーの説明コメント（任意）",
  recordedAt: "2026-04-28T15:30:00Z"
}
```

### 9-2. モデル計算

各リソースについて採否の **Laplace 平滑化** による acceptance rate を計算：

```
acceptance rate = (accepted + 1) / (total + 2)
adjustment = (acceptance_rate - 0.5) × 0.8 × confidence
```

ここで `confidence = min(1, total / 10)`。

**例**

| リソース | 承認 | 却下 | 合計 | Rate | Adjustment |
|---|---|---|---|---|---|
| apex-opt | 18 | 2 | 20 | 0.9 | +0.24 |
| lwc-form | 5 | 8 | 13 | 0.33 | -0.12 |
| flow-designer | 3 | 1 | 4 | 0.8 | +0.06 |

### 9-3. 却下理由の分類

却下には複数の理由がある：

| 理由 | 説明 |
|---|---|
| `reject_inaccurate` | 提案内容が誤っている |
| `reject_unnecessary` | 提案が不要である |
| `reject_duplicate` | 既に存在するリソースと重複 |

却下理由の分布を集計することで、改善すべき点が特定できる。

---

## 10. モデルレジストリ と Shadow/Promote パターン

### 10-1. 概要（TASK-045）

LLM モデルや推論ロジックの複数バージョンを並走させ、shadow が production を上回ったら自動 promote する仕組み。

### 10-2. モデルの登録と並走

```
① production: query-skill-v1
   shadow: query-skill-v2

② 毎回の suggest 実行時、両方のモデルで推論を実行し、結果を記録

③ 一定期間（例 100 回）の実行後、
   shadow_wins / total > threshold かつ signedDelta > margin なら
   shadow を production に promote

④ 新しい production が threshold を下回ったら自動 rollback
```

### 10-3. 並走評価メトリクス

```typescript
ModelEvaluationStats = {
  shadowVersion: "query-skill-v2",
  productionVersion: "query-skill-v1",
  total: 100,
  shadowWins: 62,
  productionWins: 35,
  ties: 3,
  signedDelta: (62 - 35) / 100 = 0.27,
  shadowWinRate: 0.62
}
```

**Promote 条件**
- `shadowWinRate >= 0.55` （55% 以上）
- `signedDelta >= 0.15` （少なくとも 15% リード）
- `total >= 50` （十分なサンプル数）

### 10-4. Rollback メカニズム

promotion 後、新しい production が低下した場合：

```
① recent 30 実行での evaluation を計算
② recentDelta < -0.1 かつ productionWinRate < 0.45 なら
③ 直前のバージョンに rollback
④ history に記録して後で分析可能にする
```

---

## 11. フィードバックループの可視化

### 11-1. タイムラインデータ

`outputs/dashboards/feedback-timeline.md` に日別の accept/reject を可視化。

```
2026-04-28: ████░░░░  85% (17 accepted, 3 rejected)
2026-04-27: ██████░░  75% (15 accepted, 5 rejected)
2026-04-26: ███░░░░░  60% (12 accepted, 8 rejected)
```

### 11-2. ヒートマップ（topic × resource）

```
         apex-opt  lwc-form  flow-des
Apex設計    ✓✓✓✓✓    ✓       ×
LWC検証     ✗✗✗      ✓✓✓✓✓   ✗
Flow構築    ×         ×       ✓✓✓✓✓
```

この表から、どのトピック × リソースの組み合わせが成功しやすいかが一目瞭然。

### 11-3. トレンド分析（rising / falling）

14 日前の accept rate と直近 14 日の accept rate を比較：

| リソース | 前期 | 現在 | Δ | トレンド |
|---|---|---|---|---|
| apex-opt | 0.75 | 0.92 | +0.17 | 📈 上昇 |
| lwc-form | 0.68 | 0.61 | -0.07 | 📉 低下 |
| flow-des | 0.80 | 0.82 | +0.02 | → 安定 |

上昇中のリソースは信頼度が高く、低下中は何か問題がないか調査の対象。

---

## 12. Cleanup Scheduler（未使用リソース自動検出）

### 12-1. 概要（TASK-041）

一定期間使用されていないリソースを自動検出し、削除提案を生成する仕組み。

### 12-2. スケジュール定義

```json
{
  "id": "cleanup-unused-skills",
  "name": "未使用スキル清掃",
  "cron": "0 2 * * 0",    // 毎週日曜 02:00
  "action": "dry-run",     // 実運用では approve 後に "apply"
  "status": "active",
  "daysUnused": 90,        // 90 日以上未使用のリソースを検出
  "limit": 10,             // 1 回の実行で最大 10 件を処理
  "requireApproval": true,
  "createdAt": "2026-01-01T00:00:00Z",
  "lastRunAt": "2026-04-28T02:15:30Z"
}
```

### 12-3. 実行フロー

```
① Scheduler が dry-run モードで起動
② 未使用リソース候補を検出：
   - 最終 usage timestamp が 90 日以上前
   - または まったく usage 記録がない

③ 候補をランキング（削除 safety score）：
   - 他リソースから依存されているか
   - 過去の成功率
   - ユーザーの明示的なピン留め

④ 提案を outputs/tool-proposals/pending/ に追加
⑤ ユーザーが approve_proposal で承認
⑥ approve_cleanup で実削除

または auto_apply_pending_proposals で
複数提案を一括処理（管理者オプション）
```

### 12-4. 検出ロジック

**未使用シグナル**

```
usage_signal = (
  trace 内での出現回数 +
  auto_select_resources の選択回数 +
  proposal_feedback の承認回数
)

if usage_signal == 0 or lastUsedAt < now - 90 days:
  → cleanup_candidate = true
```

**削除 safety score**

```
safety = (
  0.3 × adoption_rate +
  0.4 × dependent_resources_count +
  0.2 × alternative_available +
  0.1 × explicit_pin
)

if safety < 0.3:
  → safe to delete
```

---

## 13. リソースガバナンスと Disable/Enable 管理

### 13-1. ガバナンス状態の構成

```json
{
  "resource-governance.json": {
    "disabled": {
      "skills": ["obsolete-skill-1", "lwc-old-pattern"],
      "tools": ["deprecated-tool"],
      "presets": []
    },
    "quotas": {
      "daily_proposal_create_limit": 50,
      "daily_auto_apply_limit": 20,
      "bandit_exploration_rate": 0.1
    },
    "thresholds": {
      "low_confidence_threshold": 5.0,
      "low_relevance_score": 2.0,
      "gap_detection_threshold": 5
    },
    "handler_schedule": [
      {
        "toolName": "auto_select_resources",
        "startHour": 9,
        "endHour": 18,
        "days": [1, 2, 3, 4, 5],
        "allow": true,
        "timezoneOffsetMinutes": 540
      }
    ]
  }
}
```

### 13-2. Disable/Enable の活用

**disable される状況**

1. **バグが検出されたリソース**
   ```
   error_aggregate_detected → disable "buggy-skill"
   ```

2. **品質が低下したリソース**
   ```
   proposal feedback で accept rate < 0.3
   → 自動 disable と警告を output
   ```

3. **セキュリティ上の理由**
   ```
   security scan で脆弱性検出
   → disable + audit log に記録
   ```

4. **メンテナンス期間**
   ```
   handler_schedule で営業時間外は実行禁止
   ```

### 13-3. Disable 状態での auto_select_resources

disabled リソースは自動選択の対象から除外：

```typescript
const candidates = allSkills
  .filter(s => s.score > 0)
  .filter(s => !state.disabled.skills.includes(s.name))  // disable チェック
  .sort((a, b) => b.score - a.score)
  .slice(0, limit);
```

### 13-4. リソースの復旧フロー

```
① 問題リソースが disable された理由を調査
② 原因を修正（バグ fix / スキル更新）
③ `enable_resource` ツールで enable
④ 再度の試験運用（shadow mode など）
⑤ 問題なければ production に昇格
```

---

## 14. メトリクス・統計の自動集計と報告

### 14-1. 自動生成レポート

`outputs/reports/` に定期的に生成されるレポート：

| レポート | 生成頻度 | 内容 |
|---|---|---|
| `daily-summary.md` | 毎日 AM 00:30 | 前日の tool 実行数・成功率・エラー率 |
| `weekly-trends.json` | 毎週月曜 | リソース accept rate・synergy score の週次推移 |
| `skill-rating-analysis.md` | 毎週末 | ユーザー評価の集計・flagged-for-refactor の一覧 |
| `model-arbitration-status.json` | 毎日 | shadow vs production の勝利数・Delta |
| `governance-quota-usage.md` | 毎日 | daily quota の消費状況・残予算 |

### 14-2. メトリクス定義

```typescript
Metrics = {
  timestamp: ISO8601,
  tool_executions: number,
  tool_success_rate: 0..1,
  avg_response_time_ms: number,
  total_tokens_consumed: number,
  resource_selections: number,
  accepted_proposals: number,
  rejected_proposals: number,
  disabled_resources_count: number,
  active_bandit_arms: number,
  model_promotion_count: number,
  cleanup_candidates_detected: number
}
```

### 14-3. ダッシュボード統合

`outputs/dashboards/observability.html` に以下を統合：

- **システムヘルス**: tool 成功率・エラー分布・応答時間 P50/P95/P99
- **リソース成長**: 過去 30 日の新規 skills / tools / presets 数
- **学習進捗**: bandit arm 数・shadow promotion 成功率・cleanup 実施数
- **ガバナンス状況**: disabled リソース数・quota 消費率・threshold 超過イベント数
