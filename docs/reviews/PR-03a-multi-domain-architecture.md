# PR-03a: マルチドメインアーキテクチャ構築

> ステータス: 実装完了・検証通過
> 日時: 2026-05-14
> 対応: T00 ドメイン分離実装計画 Phase 2

---

## 概要

PR-01（境界確定）・PR-02（Salesforce ブリッジ）に続き、**複数ドメインの統合構造** を構築しました。

これにより、将来的に以下の拡張が容易になります：
- ServiceNow・NetSuite 等の新ドメイン追加
- 非エンジニア向けドメイン（データモデリング、UX設計等）追加

---

## 実装内容

### 1. ドメイン階層の確立

```
domains/
  ├── salesforce/       （Salesforce API 依存）
  │   ├── agents/ → 6 エージェント
  │   ├── skills/ → 7 スキルディレクトリ
  │   ├── tools/ → 24 ツール
  │   └── index.ts → SalesforcePlugin
  │
  ├── development/      （言語・フレームワーク非依存の開発支援）
  │   ├── agents/ → 5 エージェント
  │   ├── skills/ → 5 スキルディレクトリ
  │   ├── tools/ → 12 ツール
  │   │   ├── testing/
  │   │   ├── quality/
  │   │   ├── repository-analysis/
  │   │   └── governance/
  │   └── index.ts → DevelopmentPlugin
  │
  ├── core/             （抽象的・汎用的な判断）
  │   ├── agents/ → 6 エージェント
  │   ├── skills/ → 1 スキルディレクトリ
  │   ├── tools/ → 7 ツール
  │   └── index.ts → CorePlugin
  │
  └── [future: servicenow/, netsuit/, etc.]
```

### 2. ドメイン間の関係性

```
┌────────────────────────────────────────────┐
│                  Core                      │
│  (Architecture, Governance, Data Model)    │
│  全技術スタックに共通適用                 │
└───┬──────────────────────────────┬────────┘
    │                              │
┌───▼──────────┐         ┌────────▼────────┐
│ Salesforce   │         │ Development     │
│ Domain       │         │ Domain          │
│              │         │                 │
│ Salesforce   │         │ 言語非依存      │
│ 特化機能     │         │ 開発支援        │
└──────────────┘         └─────────────────┘

(将来)
└─ ServiceNow, NetSuite, その他ドメイン
```

### 3. リソース分配（最終版）

| リソース | Salesforce | Development | Core | 合計 |
|---------|-----------|-------------|------|------|
| **ツール** | 24 | 12 | 7 | 43 |
| **スキル** | 7 | 5 | 1 | 13 |
| **エージェント** | 6 | 5 | 6 | 18 |
| **ペルソナ** | 0 | 0 | 16 | 16 |
| **合計** | 37 | 22 | 30 | 89 |

### 4. DomainPlugin 実装

各ドメイン用のプラグインを作成：

**domains/salesforce/index.ts**
```typescript
export const SalesforcePlugin: DomainPlugin = {
  name: "salesforce",
  enabledByDefault: true,
  register(context) {
    context.registerSkill?.("salesforce-platform");
    context.registerAgent?.("apex-developer");
    // ... (詳細は domains/salesforce/README.md 参照)
  }
};
```

**domains/development/index.ts**
```typescript
export const DevelopmentPlugin: DomainPlugin = {
  name: "development",
  enabledByDefault: true,
  register(context) {
    context.registerSkill?.("testing");
    context.registerAgent?.("qa-engineer");
    // ... (詳細は domains/development/README.md 参照)
  }
};
```

**domains/core/index.ts**
```typescript
export const CorePlugin: DomainPlugin = {
  name: "core",
  enabledByDefault: true,
  register(context) {
    context.registerSkill?.("architecture");
    context.registerAgent?.("architect");
    // ... (詳細は domains/core/README.md 参照)
  }
};
```

### 5. 構成の段階的初期化

```typescript
import { SalesforcePlugin } from "@domains/salesforce";
import { DevelopmentPlugin } from "@domains/development";
import { CorePlugin } from "@domains/core";

// Composition root 作成
const { handlerContext, container } = createCompositionRoot({
  llmGateway,
  memoryService,
  // ... ポート実装 ...
  domainPlugins: [
    SalesforcePlugin,
    DevelopmentPlugin,
    CorePlugin
  ]
});

// プラグイン初期化
await initializeDomainPlugins(
  [SalesforcePlugin, DevelopmentPlugin, CorePlugin],
  domainPluginContext
);
```

---

## 変更ファイル一覧

### 新規作成
- ✅ `domains/development/index.ts` — DevelopmentPlugin
- ✅ `domains/development/README.md` — ドメイン説明書
- ✅ `domains/development/agents/` — フォルダ作成
- ✅ `domains/development/skills/` — フォルダ作成
- ✅ `domains/development/tools/testing/` — フォルダ作成
- ✅ `domains/development/tools/quality/` — フォルダ作成
- ✅ `domains/development/tools/repository-analysis/` — フォルダ作成
- ✅ `domains/development/tools/governance/` — フォルダ作成
- ✅ `domains/core/index.ts` — CorePlugin
- ✅ `domains/core/README.md` — ドメイン説明書
- ✅ `domains/core/agents/` — フォルダ作成
- ✅ `domains/core/skills/` — フォルダ作成
- ✅ `domains/core/tools/` — フォルダ作成

### 既存（PR-01/02）
- `mcp/composition-root.ts` — initializeDomainPlugins 関数（PR-01）
- `mcp/core/ports/domain-plugin-port.ts` — DomainPlugin インターフェース（PR-01）
- `domains/salesforce/index.ts` — SalesforcePlugin（PR-02）
- `domains/salesforce/README.md` — 日本語ドメイン説明（PR-02）
- `tsconfig.json` — `@domains/*` エイリアス（PR-01）
- `.dependency-cruiser.cjs` — ドメイン境界ルール（PR-01）

---

## 検証結果

✅ **npm run typecheck**: PASS
✅ **npm run lint:depcruise**: 既存違反のみ（新規エラーなし）
✅ **git status**: 新規ファイル確認済み

---

## 次のステップ（PR-04 以降）

### PR-04a: Wave A ファイル移動（Salesforce 分析ツール）
- `apex-analyzer.ts` → `domains/salesforce/tools/analyzers/`
- `flow-analyzer.ts` → `domains/salesforce/tools/analyzers/`
- `lwc-analyzer.ts` → `domains/salesforce/tools/analyzers/`

### PR-04b: Wave B ファイル移動（Development テスト・品質ツール）
- `coverage-estimate.ts` → `domains/development/tools/testing/`
- `analyze-test-coverage-gap.ts` → `domains/development/tools/testing/`
- `refactor-suggest.ts` → `domains/development/tools/quality/`

### PR-05+: Wave C～E（段階的に実施）

---

## 設計上の利点

1. **スケーラビリティ**: 新ドメイン追加時は、`domains/servicenow/index.ts` 作成 + `ServiceNowPlugin` 定義だけで完了
2. **保守性**: ドメインごと独立しているため、修正・追加時の影響範囲が限定される
3. **拡張性**: 非エンジニア向けドメイン（Data、UX等）を将来追加する際のテンプレートが完成
4. **テスト**: 各ドメインのテストが独立実行可能

---

## 既知の制限

- 本 PR では **ファイル移動なし**（ブリッジ段階維持）
- 実際の移動は PR-04+ で段階的に実施

---

## 関連資料

- [T00 リソースインベントリ分析](../../docs/reviews/T00-resource-inventory-analysis.md) — 詳細な分類・比較
- [T00 ドメイン分割実装計画書](../../docs/reviews/T00-domain-split-implementation-plan.md) — 全体計画
- [Salesforce ドメインプラグイン](../../domains/salesforce/README.md)
- [Development ドメインプラグイン](../../domains/development/README.md)
- [Core ドメインプラグイン](../../domains/core/README.md)
