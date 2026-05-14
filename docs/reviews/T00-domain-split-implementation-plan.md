# T00 再実装計画書：ドメイン分離（修正版）

> 出典: [persistent-ai-runtime-architecture-review.md](persistent-ai-runtime-architecture-review.md)
> 承認日: 2026-05-14
> 方針: 「壊さない・分割・検証」の 3 原則に基づく段階的移動

---

## 全体戦略

| フェーズ | 目的 | PR数 | 期間 | 完了条件 |
|---------|------|------|------|---------|
| P1: 境界確定 | 依存ルール・DI契約を固める | 1 | 当日 | typecheck + depcruise 通過 |
| P2: ブリッジ構築 | 薄い再エクスポート可能にする | 1 | 翌日 | 既存参照維持・移動なし |
| P3: 小分けシリーズ | 実装 + handler + test を同一スライスで移動 | N+1 | 1週間 | 各回で検証完了 |

---

## PR-01: 境界確定フェーズ（即日予定）

### 目的
依存方向ルールと DomainPlugin 契約を確定し、下地を安定化させる。

### 非目的
- ファイル移動は実施しない
- 既存 import は変更しない
- runtime 動作に影響なし

### 変更内容

#### 1. DomainPlugin 契約を具体化
[mcp/core/ports/domain-plugin-port.ts](mcp/core/ports/domain-plugin-port.ts) を以下に差し替え：

```typescript
/**
 * Domain plugin interface.
 * Domains can register their tools, skills, agents, and migrations
 * via this contract during runtime composition.
 */

export interface DomainToolRegistration {
  name: string;
  category: string;
  capability: string;
}

export interface DomainMigrationRegistration {
  id: string;
  description?: string;
}

export interface DomainPluginContext {
  /**
   * Register a tool from this domain into the global registry.
   * name: fully qualified tool name (e.g., "analyze-apex")
   */
  registerTool?(registration: DomainToolRegistration): void;

  /**
   * Register a skill ID that this domain provides.
   */
  registerSkill?(skillId: string): void;

  /**
   * Register an agent ID that this domain uses or specializes.
   */
  registerAgent?(agentId: string): void;

  /**
   * Register a database migration for domain-specific schema.
   */
  registerMigration?(migration: DomainMigrationRegistration): void;
}

export interface DomainPlugin {
  /** Unique domain identifier (e.g., "salesforce", "servicenow"). */
  readonly name: string;

  /** If false, plugin is skipped unless explicitly enabled. Default: true. */
  readonly enabledByDefault?: boolean;

  /**
   * Called during composition root setup.
   * Domain may register tools, skills, agents, and migrations.
   */
  register?(context: DomainPluginContext): void | Promise<void>;
}
```

#### 2. Composition Root で plugin 呼び出し登録

[mcp/composition-root.ts](mcp/composition-root.ts) の `createCompositionRoot` 関数に以下を追加：

```typescript
/**
 * Initialize registered domain plugins.
 * (After this PR: no-op, but structure prepared for future PR-02)
 */
export async function initializeDomainPlugins(
  plugins: DomainPlugin[],
  context: DomainPluginContext
): Promise<void> {
  for (const plugin of plugins.filter((p) => p.enabledByDefault !== false)) {
    await plugin.register?.(context);
  }
}
```

#### 3. dependency-cruiser ルール追加

[.dependency-cruiser.cjs](.dependency-cruiser.cjs) の `forbidden` に追加：

```javascript
{
  name: "no-runtime-import-domain-impl",
  comment: "Runtime code must not import domain-specific implementations directly; use ports and plugins.",
  severity: "error",
  from: { path: "^mcp/(core|surface|infrastructure|handlers)/" },
  to: { path: "^domains/" }
},
{
  name: "domain-use-runtime-abstractions-only",
  comment: "Domain code may depend on runtime ports/domain/runtime; not on core service implementations.",
  severity: "warn",
  from: { path: "^domains/" },
  to: {
    path: "^mcp/",
    pathNot: [
      "^mcp/core/ports/",
      "^mcp/core/domain/",
      "^mcp/core/runtime/"
    ]
  }
}
```

#### 4. tsconfig と package.json の確認（変更なし）

- [tsconfig.json](tsconfig.json) 既に `@domains/*` エイリアス・include 追加済み ✓
- [package.json](package.json) に scripts 追加は不要（既存 typecheck で十分）

### 修正ファイル一覧

- ✏️ [mcp/core/ports/domain-plugin-port.ts](mcp/core/ports/domain-plugin-port.ts) （既存、再確認）
- ✏️ [mcp/composition-root.ts](mcp/composition-root.ts) （initializeDomainPlugins 追加）
- ✏️ [.dependency-cruiser.cjs](.dependency-cruiser.cjs) （2ルール追加）
- ✓ [tsconfig.json](tsconfig.json) （既に設定済み）

### 検証手順

```bash
npm run typecheck        # 型チェック
npm run lint:depcruise   # 依存ルール確認
git status --short       # 変更確認
```

### PR 説明テンプレート

```
## [PR-01] Domain Plugin 契約と依存境界の確定

### 目的
- DomainPlugin interface を具体化
- Composition root に plugin initialization 構造を準備
- 依存方向ルールを depcruise に反映

### 非目的
- ファイル移動は実施していない
- 既存動作・参照に変化なし

### 検証結果
- ✅ npm run typecheck: pass
- ✅ npm run lint:depcruise: pass
- ✅ 既存テスト: pass

### ロールバック
git revert <commit>
```

---

## PR-02: ブリッジ構築フェーズ（翌日予定）

### 目的
domains/salesforce 側の薄い公開面を作成し、将来の段階移動に備える。

### 非目的
- 実ファイル移動は **実施しない**
- 既存 import は変更しない

### 変更内容

#### 1. domains/salesforce の骨組み確認

```
domains/
  salesforce/
    index.ts                    ← SalesforcePlugin export
    package.md                  ← ドメイン説明（オプション）
    analysis/                   ← 今後の移動先
      apex/
        (signature-diff.ts は PR-03 で移動)
    tools/                      ← 今後の移動先
      (ファイルは PR-03+ で段階移動)
    handlers/                   ← 今後の移動先
    agents/                     ← 今後の移動先
    skills/                     ← 今後の移動先
    db/
      migrations/               ← 今後の移動先
```

#### 2. [domains/salesforce/index.ts](domains/salesforce/index.ts) で SalesforcePlugin 定義

```typescript
import type { DomainPlugin } from "../../mcp/core/ports/domain-plugin-port.js";

export const SalesforcePlugin: DomainPlugin = {
  name: "salesforce",
  enabledByDefault: true,
  register(context) {
    // 今後段階的に追加:
    // context.registerTool?({ ... });
    // context.registerAgent?("apex-developer");
    // context.registerSkill?("apex");
    // ...
  }
};
```

#### 3. README の追加（オプション）

[domains/salesforce/README.md](domains/salesforce/README.md) を作成：

```markdown
# Salesforce Domain Plugin

This domain encapsulates all Salesforce-specific analysis, tools, agents, and skills.

## Scope
- Apex / LWC / Flow / Permission Set analyzers
- Deployment, testing, security scanning tools
- Salesforce specialists (apex-developer, lwc-developer, etc.)
- Salesforce-specific skills

## Status
Currently in **bridge phase**: code resides in `mcp/tools`, `mcp/handlers`, etc.
Will be gradually moved to `domains/salesforce/*` in PR-03+.

## Migration Timeline
- PR-02: Bridge structure (this file)
- PR-03+: Staged file moves (1-2 per PR, typecheck before/after each)
```

### 修正ファイル一覧

- ✏️ [domains/salesforce/index.ts](domains/salesforce/index.ts) （既存、内容確認）
- 📝 [domains/salesforce/README.md](domains/salesforce/README.md) （新規、オプション）
- ✓ フォルダ構造は既に存在

### 検証手順

```bash
npm run typecheck
npm run lint:depcruise
git status --short
```

### 注意
**ファイル移動は含まない**。import パスは一切変わらない。

---

## PR-03: 小分け段階移動フェーズ（3日目以降・複数PR）

### 原則

1. **1回につき 1 スライス（実装 1-3 + 関連 handler + 関連 test）**
2. **import 修正は実装・handler・test を同時に行う**
3. **移動前後で必ず検証（typecheck + 対象テスト）**
4. **問題あれば即 git revert**

### 推奨移動順

#### Wave A: Apex 補助ツール（依存が浅い）
- PR-03a: `mcp/core/apex/signature-diff.ts` → `domains/salesforce/analysis/apex/signature-diff.ts`
  - 参照先: `mcp/tools/apex-changelog.ts` のみ修正
  - 検証: apex-changelog test pass

#### Wave B: Salesforce 分析スライス（実装 + handler + test）
- PR-03b: `apex` 系の 1 スライスをまとめて移動
  - 例: 実装 (`mcp/tools/*`) + handler (`mcp/handlers/*`) + test (`tests/*`) を同一PRで整合
  - 検証: typecheck + 対象テスト

#### Wave C: Development スライス（実装 + handler + test）
- PR-03c+: `domains/development/` 対象も同様に同一スライス移動
  - 検証: typecheck + 対象テスト

（以下同様に 1 スライスずつ）

#### Wave D: 複合依存ツール（後回し）
- `apex-dependency-graph.ts` など
- 後の PR-03g+ で対応

### 1 スライス移動 PR のテンプレート

```
## [PR-03a] Move mcp/core/apex/signature-diff.ts to domains/salesforce/analysis/apex/

### Changes
1. Move: mcp/core/apex/signature-diff.ts → domains/salesforce/analysis/apex/signature-diff.ts
2. Update import in: mcp/tools/apex-changelog.ts
3. Update doc reference: docs/CHANGELOG.md (if any)

### Non-Goals
- No cross-domain refactor beyond current slice
- No unrelated file movements

### Verification
- ✅ npm run typecheck: pass
- ✅ npm run lint:depcruise: pass
- ✅ npm test -- apex-changelog: pass

### Rollback
git revert <commit>
```

### 小分けのコツ

1. 移動前に import 箇所を grep で全列挙（実装 + handler + test）
2. 実装を移動（必要なら一時シムを置く）
3. handler を同じドメイン配下へ移動/更新
4. test を同じドメイン境界に合わせて移動/更新
5. import を一括更新
6. typecheck
7. 対象テスト実行
8. 旧ファイル削除

---

## チェックリスト

### PR-01 前
- [ ] この計画書を読了
- [ ] [docs/reviews/persistent-ai-runtime-architecture-review.md](docs/reviews/persistent-ai-runtime-architecture-review.md) を参照

### PR-01 着手
- [ ] DomainPlugin 型を確定
- [ ] composition-root に initializeDomainPlugins を追加
- [ ] depcruise ルール追加
- [ ] typecheck + depcruise 通過

### PR-02 着手
- [ ] domains/salesforce/index.ts で SalesforcePlugin 定義
- [ ] README 作成（オプション）
- [ ] typecheck 通過

### PR-03a 着手（初回移動）
- [x] signature-diff.ts を新フォルダへコピー
- [x] apex-changelog.ts の import を修正
- [x] docs 参照を修正
- [x] 検証: typecheck + test
- [x] 旧ファイル削除
- [ ] git log で参照漏れ確認

### PR-03b 以降
- [ ] 1 スライス（実装 + handler + test）ずつ移動
- [ ] 参照全て update（実装・handler・test）
- [ ] テスト実行（対象スライス）
- [ ] 破損時は即 revert（悪あがきしない）

---

## 参考: 破損時の対応

```bash
# もし typecheck が失敗したら
git diff mcp/tools/ | head -20  # 何が変わったか確認
git log -1 --stat                # 最後の変更を確認
git revert HEAD                  # 無条件に戻す

# 以降、差分を小さくして再着手
```

---

_End of PR-01/02/03 planning document._
