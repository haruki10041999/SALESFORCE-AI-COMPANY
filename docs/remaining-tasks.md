# 残タスク一覧 (2026年4月27日)

## ✅ 完了（このセッション）

| タスク | 内容 | 状態 |
|--------|------|------|
| F-13 | Unit-of-Work + 2フェーズコミット | ✅ 実装・テスト済 |
| F-23 | トークン推定ベースのコスト見積 | ✅ テスト済 |
| F-25 | ユーザー明示フィードバック API (👍/👎) | ✅ 実装・テスト済 |
| F-24 | オフライン評価ハーネス | ✅ 実装・テスト済、`learning:replay` CLI 公開 |

---

## 📋 今回実装対象：9件

ユーザーメモリ方針に基づく実装対象タスク

### 優先度順（推奨着手順）

#### グループ 1: 基盤・統計分析（工数: 中）
- **F-26** - A/B 因果分析（層別解析）
  - 既存 `analyze_ab_test_history` ツールを拡張
  - 統計的有意性検定、層別解析の追加
  - 関連ファイル: `mcp/tools/analyze-ab-test-history.ts`

#### グループ 2: プロンプト動的化（工数: 小～中）
- **F-15** - テンプレート変数化（Mustache）
  - prompt-engine での変数挿入
  - 関連ファイル: `prompt-engine/prompt-builder.ts`

- **F-16** - Reasoning 戦略の動的選択
  - Plan / Reflect / Tree-of-Thought の自動選択
  - LLM による戦略推論
  - 関連ファイル: `prompt-engine/reasoning-framework.md`

#### グループ 3: Salesforce ツール統合（工数: 小～中）
- **複数Org差分比較ツール** - Metadata 差分分析
  - `mcp_compare_org_metadata` の機能統合
  - 関連ファイル: `mcp/tools/compare-org-metadata.ts`

- **Flow条件シミュレータ** - トリガー条件の事前評価
  - decision-tree 評価エンジン実装
  - 関連ファイル: `mcp/tools/simulate-flow-conditions.ts` (新規)

- **Permission Set差分検出** - アクセス権限の過不足検出
  - compare_permission_sets の強化
  - 関連ファイル: `mcp/tools/compare-permission-sets.ts`

- **Apex依存グラフ可視化** - クラス間依存関係の可視化
  - generate_dependency_graph の統合
  - Mermaid/D3 での可視化
  - 関連ファイル: `mcp/tools/generate-dependency-graph.ts`

#### グループ 4: 学習・最適化（工数: 中）
- **F-18** - Self-Refine ループ
  - LLM による自己修正反復
  - 関連ファイル: `mcp/core/learning/self-refine-loop.ts` (新規)

- **F-19** - Contextual Bandit（LinUCB）
  - 連続値報酬による A/B 最適化
  - 関連ファイル: `mcp/core/learning/lin-ucb-bandit.ts` (新規)

#### グループ 5: 運用・デバッグ（工数: 小）
- **提案ログ学習フィードバック** - Tool proposal の成功率学習
  - feedback-manager と proposal-feedback の統合
  - 関連ファイル: `mcp/core/resource/proposal-feedback.ts`

- **デバッグログ可視化強化** - system-event-manager + OTLP ダッシュボード
  - 統合ダッシュボード実装
  - 関連ファイル: `outputs/dashboards/`

- **CLIエントリポイント整備** - `npm run ai -- <command>` 統一化
  - 既実装、整理・ドキュメント化
  - 関連ファイル: `scripts/ai.ts`

- **雛形ジェネレータ実装** - Agent/Skill/Preset テンプレート生成
  - scaffold-generator 実装
  - 関連ファイル: `scripts/scaffold-generator.ts` (新規)

- **outputs世代管理と復元** - Snapshot 管理、時点復元
  - 既実装 (outputs/backups)、整理・ドキュメント化
  - 関連ファイル: `mcp/core/governance/snapshot-manager.ts`

---

## 🔍 検証対象（実装済み、動作確認のみ）

| タスク | 内容 | ファイル |
|--------|------|---------|
| F-20 | OpenTelemetry (OTLP → Jaeger) | `mcp/core/observability/otel-tracer.ts` |
| F-22 | Prometheus `/metrics` エンドポイント | `mcp/core/observability/prometheus-metrics.ts` |

---

## ⏳ 未実装タスク（今回対象外）

### LLM 連携・テスト
- **T-OLLAMA-04** - LLM-as-Judge を Ollama Chat に統合
  - quality-rubric の Ollama 統合強化
  - 関連ファイル: `mcp/core/quality/quality-rubric.ts`

- **T-OLLAMA-07** - Ollama モック/統合テスト
  - テスト環境構築

### A-series 拡張機能（19タスク）
- Agent Persona 拡張
- Governance UI
- セキュリティスキャン
- 他多数

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

