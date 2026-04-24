# 検証ガイド（技術向け）

このページは、開発変更の検証手順をまとめた技術向けドキュメントです。
日常運用のチェックは `operations-guide.md` を参照してください。

## 標準検証フロー

1. ビルド

```bash
npm run build
```

2. 型チェック

```bash
npm run typecheck
```

3. テスト

```bash
npm test
```

4. 健全性チェック

```bash
npm run doctor
```

## 変更タイプ別の追加検証

### 解析ツールを追加・変更した場合

- 対象テストを個別実行

```bash
node --test --import tsx tests/apex-dependency-graph.test.ts
node --test --import tsx tests/permission-set-diff.test.ts
```

### 学習・推薦ロジックを変更した場合

```bash
node --test --import tsx tests/proposal-feedback.test.ts
```

### 登録系（handler/server catalog）を変更した場合

- `npm run build` 成功
- 追加ツール名が `mcp/server.ts` のカタログに存在
- 対応する `docs/features` の更新がある

### ストレステスト・性能測定（TASK-010）を進める場合

1. ベンチマーク実行

```bash
npm run benchmark:run
```

2. メトリクススナップショット生成

```bash
npm run metrics:snapshot
```

3. ダッシュボード生成（傾向確認）

```bash
npm run metrics:dashboard
```

評価時は [docs/metrics-evaluation.md](./metrics-evaluation.md) のしきい値（success rate / p95 / エラー率）を併せて確認する。

### 高負荷トレース回帰（TASK-011）を進める場合

1. 高負荷シナリオの集計安定性テストを実行

```bash
node --import tsx --test tests/new-tools.test.ts
```

2. 次のケースが pass していることを確認

- `summarizeMetrics and benchmark suite remain stable with high trace volume`
- 完了トレース数が履歴上限（既定 500）を超えても、集計とスコア計算が失敗しないこと

## リリース前チェック

- `npm run build` 成功
- `npm test` で fail 0
- `CHANGELOG.md` 更新済み
- 必要なドキュメント更新済み（設定・運用・機能仕様）
- 全機能の動作確認は [full-feature-verification.md](./full-feature-verification.md) を参照

## 追加検証カテゴリ (2026-04 Phase 2-4)

### Property-based test (TASK-048)

```bash
npm test -- tests/property-based.test.ts
```

`fast-check` を用いた scoring / learning / trust モジュールの不変条件テスト。

### Phase 計測の確認 (TASK-038)

`chat` / `orchestrate_chat` 実行後に `metrics_summary` の `phaseBreakdown` を確認し
input / plan / execute / render の duration が記録されていること。

### Synergy 推奨 (TASK-043)

```bash
# trace 蓄積後
node --import tsx --test tests/core-modules.test.ts
```

加えて MCP ツール `synergy_recommend_combo` を呼び出し JSON 結果を確認。

### Benchmark nightly (TASK-050)

```bash
npm run benchmark:run -- --output outputs/benchmark/local.json
```

ローカル動作確認。CI は `.github/workflows/benchmark-nightly.yml` が毎日実行。

## 関連ドキュメント

- `operations-guide.md`
- `developer-guide.md`
- `documentation-map.md`
- `full-feature-verification.md`
