# Context

エージェント実行時のプロンプト構築・コンテキスト注入メカニズムです。

## コンテキストレイヤーの役割

MCP サーバー内で、すべてのエージェント実行時に共通の背景情報を自動注入します。

```
User Input
    ↓
Agent Selection
    ↓
Context Layer ← ★ ここで自動注入
    ├─ coding-conventions.md
    ├─ environments.md
    ├─ project.md
    └─ prompt-engine/
        ├─ base-prompt.md
        ├─ reasoning-framework.md
        ├─ discussion-framework.md
        ├─ review-mode.md
        ├─ prompt-builder.ts
        └─ prompt-evaluator.ts
    ↓
Prompt to LLM
    ↓
Response
```

## コンテキスト構成ファイル

### 1. `context/project.md`
プロジェクト全体・組織・役割。

| 項目 | 例 |
|---|---|
| Project Name | Salesforce AI Company |
| Organization | Internal Development |
| Primary Goal | Salesforce 開発支援 MCP |
| Key Constraints | Japan timezone / Node.js |

### 2. `context/coding-conventions.md`
コード規約・スタイルガイド・ベストプラクティス。

| 項目 | 内容 |
|---|---|
| Language | TypeScript / JavaScript / Apex / etc. |
| Naming | camelCase / PascalCase / snake_case |
| File Organization | mcp/, scripts/, tests/ |
| Linting | ESLint / TSLint 設定 |
| Formatting | Prettier 設定 |

### 3. `context/environments.md`
実行環境・ステージング・デプロイ・Salesforce org 構成。

| 環境 | 用途 |
|---|---|
| local | 開発 |
| dev-sandbox | 個人開発 |
| full-sandbox | 統合テスト |
| production | 本番 |

## プロンプトエンジン

### `prompt-engine/base-prompt.md`
全エージェント共通ベースプロンプト。

### `prompt-engine/reasoning-framework.md`
推論フレームワーク（CoT / Tree of Thought）。

### `prompt-engine/discussion-framework.md`
複数エージェント議論・合意形成フレームワーク。

### `prompt-engine/review-mode.md`
レビュー用プロンプト（詳細・段階的）。

## プロンプト構築パイプライン

```
┌─────────────────────────────────────────┐
│   User Request                          │
└────────────────┬────────────────────────┘
                 ↓
        ┌────────────────────┐
        │ Select Agent       │
        │ Select Persona(s)  │
        │ Select Skills      │
        └────────┬───────────┘
                 ↓
        ┌────────────────────────────────┐
        │ prompt-engine/prompt-builder   │
        │ (TypeScript)                   │
        │                                │
        │ assembles:                     │
        │  - base-prompt.md              │
        │  - reasoning framework         │
        │  - agent instructions          │
        │  - persona style               │
        │  - relevant skills             │
        │  - context (project/env/etc)   │
        └────────┬─────────────────────┘
                 ↓
      ┌──────────────────────────┐
      │ Prompt Cache             │
      │ (optional optimization)  │
      └────────┬─────────────────┘
               ↓
      ┌──────────────────────────┐
      │ Send to LLM              │
      │ (Ollama / 3rd-party)     │
      └──────────────────────────┘
```

### `prompt-engine/prompt-builder.ts`
プロンプト動的構築（TypeScript）。

```typescript
export interface PromptConfig {
  agent: string;
  personas?: string[];
  skills?: string[];
  mode: "normal" | "review" | "discussion";
  contextDepth: "minimal" | "standard" | "full";
}

export function buildPrompt(config: PromptConfig): string {
  // 1. Base + reasoning framework
  // 2. Agent instructions
  // 3. Persona styles
  // 4. Skill references
  // 5. Context injection
  // 6. History (optional)
  // 7. Return full prompt
}
```

### `prompt-engine/prompt-evaluator.ts`
プロンプト品質評価。

```typescript
export function evaluatePromptQuality(prompt: string): {
  relevance: number;      // 0..1
  completeness: number;   // 0..1
  clarity: number;        // 0..1
  tokenCount: number;
} { ... }
```

## 実行時コンテキスト注入

エージェント実行時に自動的に注入されるコンテキスト：

```yaml
system_context:
  project: Salesforce AI Company
  environment: dev-sandbox
  timestamp: 2026-04-28T12:34:56Z
  
coding_standards:
  language: TypeScript
  style: camelCase
  
constraints:
  token_limit: 8000
  reasoning_depth: "standard"
  
available_tools:
  - apex:parse
  - apex:analyze
  - flow:simulator
  # ... 113+ tools
  
agent_prompt: |
  You are apex-developer agent.
  Focus on: Apex code quality, performance, testing.
  
persona_style: |
  Persona: engineer
  Style: technical, precise, implementation-focused
  
relevant_skills:
  - apex-best-practices
  - apex-testing
  - apex-async-patterns

project_conventions:
  naming: camelCase
  file_structure: mcp/tools/*.ts
  testing: node:test
```

## コンテキスト層の最適化

### プロンプトキャッシング
頻繁に使用するコンテキスト部分をキャッシュ。

```
mcp/core/context/
├── prompt-cache-persistence.ts
├── prompt-cache-manager.ts
└── prompt-cache-invalidation.ts
```

キャッシュ戦略：
- **TTL ベース** — デフォルト 10 分
- **イベント ベース** — コンテキスト変更時に invalidate
- **サイズ制限** — 最大 100MB / 100,000 エントリ

### コンテキスト圧縮
不要情報を削減して トークン効率を向上。

## 新規コンテキスト追加

プロジェクト固有のコンテキストを追加：

```bash
# context/ に新規 Markdown 作成
echo "# My Custom Context

Key Information:
..." > context/my-context.md

# プロンプトビルダーで参照
npm run ai -- \
  --agent apex-developer \
  --context "my-context" \
  --input "..."
```

## 参考

- [エージェント一覧](../agents/README.md)（コンテキスト受信側）
- [スキル一覧](../skills/README.md)（スキルコンテキスト）
- [ペルソナ一覧](../personas/README.md)（ペルソナスタイル）
- [アーキテクチャドキュメント](../docs/system-architecture-with-uml.md)（全体系）
