# プリセット・定義取得ツール

エージェント・スキル・ペルソナの定義参照と、繰り返し使うワークフローをプリセットとして保存・実行するツール群です。

---

## 定義取得ツール

### list_agents

利用可能なエージェントの一覧とサマリーを返します。

**入力パラメータ**: なし

**出力例**:

```json
[
  { "name": "architect", "summary": "システム設計・アーキテクチャレビューを担当" },
  { "name": "qa-engineer", "summary": "品質保証・テスト設計を担当" }
]
```

### get_agent

指定したエージェントの Markdown 定義全文を返します。

**入力パラメータ**:

| パラメータ | 型 | 必須 | 説明 |
|---|---|---|---|
| `name` | string | ✓ | エージェント名（例: `"architect"`） |

**入力例**:

```text
get_agent:
  name: "architect"
```

---

### list_skills

利用可能なスキルの一覧とサマリーを返します。

**入力パラメータ**: なし

**スキルの種別一覧**:

```
apex/          - Apex 開発スキル
architecture/  - アーキテクチャスキル
data-model/    - データモデルスキル
debug/         - デバッグスキル
devops/        - DevOps スキル
documentation/ - ドキュメントスキル
integration/   - 統合スキル
lwc/           - LWC スキル
performance/   - パフォーマンススキル
refactor/      - リファクタリングスキル
salesforce-platform/ - Salesforce プラットフォームスキル
security/      - セキュリティスキル
testing/       - テストスキル
```

### get_skill

指定したスキルの Markdown 定義全文を返します。

**入力パラメータ**:

| パラメータ | 型 | 必須 | 説明 |
|---|---|---|---|
| `name` | string | ✓ | スキル名（例: `"apex/apex-best-practices"`） |

**入力例**:

```text
get_skill:
  name: "apex/apex-best-practices"
```

---

### list_personas

利用可能なペルソナの一覧とサマリーを返します。

**入力パラメータ**: なし

**利用可能なペルソナ**:

| 名前 | 特徴 |
|---|---|
| `archivist` | 記録・分類を重視する慎重派 |
| `captain` | チームをまとめるリーダー型 |
| `commander` | 迅速な意思決定を優先する指揮官型 |
| `detective` | 問題の根本原因を掘り下げる分析型 |
| `diplomat` | 合意形成を優先する調停者型 |
| `doctor` | 診断・治療のメタファーでシステムを分析 |
| `engineer` | 実装の具体性と正確性を重視 |
| `gardener` | 長期的な保守性と成長を重視 |
| `hacker` | 創造的・非線形なアプローチ |
| `historian` | 過去の文脈と変化の追跡を重視 |
| `inventor` | 革新的なソリューションを提案 |
| `jedi` | バランスと知恵を重視する導師型 |
| `samurai` | 誠実・精密・規律を重視 |
| `speed-demon` | 速度とスループットを最優先 |
| `strategist` | 長期戦略と全体最適を重視 |

---

## プリセットツール

### create_preset

ワークフロー設定をプリセットとして `outputs/presets/` に保存します。
一度作成すれば `run_preset` で繰り返し呼び出せます。

**入力パラメータ**:

| パラメータ | 型 | 必須 | 説明 |
|---|---|---|---|
| `name` | string | ✓ | プリセット名（ファイル名に使用） |
| `description` | string | ✓ | プリセットの説明 |
| `topic` | string | ✓ | デフォルトトピック |
| `agents` | string[] | ✓ | 参加エージェント名 |
| `skills` | string[] | — | 適用スキル |
| `persona` | string | — | ペルソナ |
| `filePaths` | string[] | — | コンテキストファイル |
| `triggerRules` | array | — | オーケストレーショントリガールール |

**出力フィールド**:

| フィールド | 型 | 説明 |
|---|---|---|
| `created` | boolean | 作成成功 |
| `name` | string | プリセット名 |
| `path` | string | 保存先ファイルパス |

**入力例（開発レビュー用プリセット）**:

```text
create_preset:
  name: "Salesforce 開発レビュー"
  description: "Apex/LWC 実装レビュー用の標準プリセット"
  topic: "実装レビュー"
  agents: ["architect", "qa-engineer", "security-engineer"]
  skills: ["apex/apex-best-practices", "security/apex-sharing"]
```

**入力例（トリガーあり）**:

```text
create_preset:
  name: "セキュリティ重点レビュー"
  description: "セキュリティ観点を中心にした高度レビュー"
  topic: "セキュリティレビュー"
  agents: ["security-engineer", "architect"]
  skills: ["security/apex-sharing", "security/soql-injection"]
  triggerRules:
    - whenAgent: "security-engineer"
      thenAgent: "architect"
      messageIncludes: "修正"
      reason: "修正が必要な場合に architect を召喚"
      once: true
```

---

### list_presets

保存済みプリセットの一覧を返します。

**入力パラメータ**: なし

**出力例**:

```json
[
  {
    "name": "Salesforce 開発レビュー",
    "description": "Apex/LWC 実装レビュー用の標準プリセット",
    "agents": ["architect", "qa-engineer", "security-engineer"]
  }
]
```

---

### run_preset

プリセットを実行してプロンプトを生成します。
`overrideTopic` や `appendInstruction` でその場限りの変更が可能です。

**入力パラメータ**:

| パラメータ | 型 | 説明 |
|---|---|---|
| `name` | string | 実行するプリセット名 |
| `overrideTopic` | string | プリセットのトピックを上書き |
| `appendInstruction` | string | プロンプト末尾に追加する補足指示 |

**入力例**:

```text
run_preset:
  name: "Salesforce 開発レビュー"
  overrideTopic: "Apex セキュリティ観点レビュー"
  appendInstruction: "SOQL in loop と sharing を重点確認"
```

---

## 既定プリセットの提案

以下は copilot-instructions.md で定義されている既定プリセットです。

| 用途 | プリセット名 |
|---|---|
| 実装・設計レビュー | `Salesforce 開発レビュー` |
| セキュリティ・プライバシー確認 | `セキュリティ・コンプライアンス確認` |
| リリース・デプロイ準備 | `リリース準備チェック` |

---

## 関連ドキュメント

- [docs/features/05-chat-generation.md](./05-chat-generation.md) — chat / smart_chat の詳細
- [docs/features/06-orchestration.md](./06-orchestration.md) — triggerRules の活用
- [docs/features/09-resource-governance.md](./09-resource-governance.md) — プリセットの enable/disable
- [docs/configuration.md](../configuration.md) — 環境変数一覧
