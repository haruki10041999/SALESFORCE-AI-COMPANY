# 残タスク一覧 (2026年4月27日)

## ✅ 完了（このセッション）

| タスク | 内容 | 状態 |
|--------|------|------|
| F-13 | Unit-of-Work + 2フェーズコミット | ✅ 実装・テスト済 |
| F-23 | トークン推定ベースのコスト見積 | ✅ テスト済 |
| F-25 | ユーザー明示フィードバック API (👍/👎) | ✅ 実装・テスト済 |
| F-24 | オフライン評価ハーネス | ✅ 実装・テスト済、`learning:replay` CLI 公開 |
| F-15 | テンプレート変数化（Mustache互換プレースホルダ） | ✅ 実装・テスト済 |
| F-16 | Reasoning 戦略の動的選択 | ✅ 実装・テスト済 |
| F-18 | Self-Refine ループ | ✅ 実装・テスト済 |
| F-19 | Contextual Bandit（LinUCB） | ✅ 実装・テスト済 |
| F-26 | A/B 因果分析（層別 + 有意差推定） | ✅ 実装・テスト済 |
| 複数Org差分比較ツール | Metadata 差分分析 | ✅ 実装・テスト済 |
| Flow条件シミュレータ | トリガー条件の事前評価 | ✅ 実装・テスト済 |
| Permission Set差分検出 | アクセス権限の過不足検出 | ✅ 実装・テスト済 |
| 提案ログ学習フィードバック | Tool proposal の成功率学習 | ✅ 実装・テスト済 |
| T-OLLAMA-04 | LLM-as-Judge を Ollama Chat に統合 | ✅ 実装・テスト済 |
| T-OLLAMA-07 | Ollama モック/統合テスト | ✅ 実装・テスト済 |

---

## 📋 今回実装対象：9件

ユーザーメモリ方針に基づく実装対象タスク

### 優先度順（推奨着手順）

#### グループ 1: 基盤・統計分析（工数: 中）
- **F-26** - A/B 因果分析（層別解析） ✅ 完了
  - 既存 `analyze_ab_test_history` ツールを拡張
  - 統計的有意性検定、層別解析を追加
  - 関連ファイル: `mcp/core/learning/ab-causal-analysis.ts`, `mcp/handlers/register-analytics-tools.ts`

#### グループ 2: プロンプト動的化（工数: 小～中）
- **F-15** - テンプレート変数化（Mustache） ✅ 完了
  - prompt-engine での変数挿入
  - 関連ファイル: `prompt-engine/prompt-builder.ts`

- **F-16** - Reasoning 戦略の動的選択 ✅ 完了
  - Plan / Reflect / Tree-of-Thought の自動選択
  - LLM による戦略推論
  - 関連ファイル: `prompt-engine/reasoning-framework.md`, `prompt-engine/prompt-builder.ts`, `mcp/handlers/register-vector-prompt-tools.ts`

#### グループ 3: Salesforce ツール統合（工数: 小～中）
- **複数Org差分比較ツール** - Metadata 差分分析 ✅ 完了
  - `mcp_compare_org_metadata` の機能統合
  - 関連ファイル: `mcp/tools/org-metadata-diff.ts`, `mcp/handlers/register-core-analysis-tools.ts`

- **Flow条件シミュレータ** - トリガー条件の事前評価 ✅ 完了
  - decision-tree 評価エンジン実装
  - 関連ファイル: `mcp/tools/flow-condition-simulator.ts`, `mcp/handlers/register-core-analysis-tools.ts`

- **Permission Set差分検出** - アクセス権限の過不足検出 ✅ 完了
  - compare_permission_sets の強化
  - 関連ファイル: `mcp/tools/permission-set-diff.ts`, `mcp/handlers/register-core-analysis-tools.ts`

- **Apex依存グラフ可視化** - クラス間依存関係の可視化
  - generate_dependency_graph の統合
  - Mermaid/D3 での可視化
  - 関連ファイル: `mcp/tools/generate-dependency-graph.ts`

#### グループ 4: 学習・最適化（工数: 中）
- **F-18** - Self-Refine ループ ✅ 完了
  - LLM による自己修正反復
  - 関連ファイル: `mcp/core/learning/self-refine-loop.ts`, `mcp/handlers/register-vector-prompt-tools.ts`

- **F-19** - Contextual Bandit（LinUCB） ✅ 完了
  - 連続値報酬による A/B 最適化
  - 関連ファイル: `mcp/core/learning/lin-ucb-bandit.ts`, `mcp/handlers/register-analytics-tools.ts`

#### グループ 5: 運用・デバッグ（工数: 小）
- **提案ログ学習フィードバック** - Tool proposal の成功率学習 ✅ 完了
  - feedback-manager と proposal-feedback の統合
  - 関連ファイル: `mcp/core/resource/proposal-feedback.ts`, `mcp/handlers/register-resource-governance-tools.ts`

- **デバッグログ可視化強化** - system-event-manager + OTLP ダッシュボード ✅ 完了
  - 統合ダッシュボード実装
  - 関連ファイル: `mcp/core/observability/dashboard.ts`, `mcp/handlers/register-analytics-tools.ts`, `scripts/observability-dashboard.ts`

- **CLIエントリポイント整備** - `npm run ai -- <command>` 統一化 ✅ 完了
  - 主要運用コマンドを `npm run ai -- ...` 導線に統一
  - 関連ファイル: `scripts/ai.ts`, `docs/operations-guide.md`

- **雛形ジェネレータ実装** - Agent/Skill/Preset テンプレート生成 ✅ 完了
  - scaffold Wizard / 非対話モードで preset 生成に対応
  - 関連ファイル: `scripts/scaffold.ts`, `docs/feature-usage-guide.md`

- **outputs世代管理と復元** - Snapshot 管理、時点復元 ✅ 完了
  - backup/list/restore/wipe 導線を運用ガイドへ整理
  - 関連ファイル: `scripts/outputs-version.ts`, `mcp/core/governance/outputs-versioning.ts`, `docs/operations-guide.md`

---

## 🔍 検証対象（実装済み、動作確認のみ）

| タスク | 内容 | ファイル |
|--------|------|---------|
| F-20 | OpenTelemetry (OTLP → Jaeger) | ✅ 実装・テスト検証済 (`mcp/core/observability/otel-tracer.ts`) |
| F-22 | Prometheus `/metrics` エンドポイント | ✅ 実装・テスト検証済 (`mcp/core/observability/prometheus-metrics.ts`) |

---

## ⏳ 未実装タスク（今回対象外）

### LLM 連携・テスト
- **T-OLLAMA-04** - LLM-as-Judge を Ollama Chat に統合 ✅ 完了
  - quality-rubric の Ollama 統合強化
  - 関連ファイル: `mcp/core/llm/quality-rubric.ts`, `mcp/core/llm/ollama-client.ts`

- **T-OLLAMA-07** - Ollama モック/統合テスト ✅ 完了
  - テスト環境構築
  - 関連ファイル: `tests/quality-rubric.test.ts`

### A-series 拡張機能（確認結果）

#### 実装・テスト確認済み
- A1, A2, A3, A4, A5, A6, A7, A8, A9, A10, A14, A15, A16, A18, A19

#### 外部連携扱い（CHANGELOG 方針により本リポジトリでは除外）
- A11, A12, A13, A17

#### 補足
- 上記は `docs/CHANGELOG.md` と `tests/*` の突合で確認。
- `npm test tests/new-tools.test.ts tests/server-tools.integration.test.ts` 実行で、関連統合テストはすべて pass。

---

## 🛠️ 実装ガイド

### 共通手順
1. **テスト設計** - 対応する `tests/*.test.ts` を新規作成
2. **実装** - `mcp/tools/` または `mcp/core/*/` に実装
3. **CLI 登録** - `scripts/ai.ts` に entry を追加
4. **ドキュメント** - `docs/` に使用例を追加
5. **動作確認** - `npm test` で全テスト実行

### グループ別推奨着手順序

**フェーズ 1（1-2日）: 基盤固め**
1. F-26 (A/B 因果分析)
2. F-15 (Mustache テンプレート)

**フェーズ 2（2-3日）: Salesforce 統合**
3. 複数Org差分比較
4. Flow条件シミュレータ
5. Permission Set差分
6. Apex依存グラフ

**フェーズ 3（2-3日）: 学習・最適化**
7. F-16 (推論戦略選択)
8. F-18 (Self-Refine)
9. F-19 (LinUCB)

**フェーズ 4（1日）: 運用・クリーンアップ**
10. 提案ログ学習フィードバック
11. デバッグログ可視化
12. CLIエントリ整備
13. 雛形ジェネレータ
14. outputs世代管理

---

## 📊 進捗追跡

実装時に以下の形式で更新してください：

```markdown
### [タスク名]
- [ ] テスト設計
- [ ] 実装
- [ ] CLI登録
- [ ] ドキュメント
- [ ] 動作確認
```

---

## 💡 参考資料

- [開発ガイド](developer-guide.md)
- [プロンプト エンジン](../prompt-engine/base-prompt.md)
- [学習フレームワーク](../prompt-engine/reasoning-framework.md)
- [MCP ツール カタログ](../outputs/tool-catalog.json)

