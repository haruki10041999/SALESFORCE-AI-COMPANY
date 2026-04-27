# 学習の仕組みガイド

このドキュメントは、このリポジトリで何がどう学習されるかを、運用目線でまとめたものです。

このシステムの学習は、主に次の 5 系統に分かれます。

- 提案採用ログから学ぶ推薦補正
- クエリとスキルの相性を学ぶ漸進モデル
- スキル満足度を学ぶ評価モデル
- A/B テストやフィードバックを反映するエージェント信頼履歴
- 探索と活用のバランスを取る bandit / shadow model 基盤

## 全体像

学習の入力は主に次の 4 種類です。

- 採用 / 不採用フィードバック
- スキル利用後の 1〜5 レーティング
- A/B テストの勝敗結果
- 実行ログや trace から得られる成功 / 失敗シグナル

学習結果は次に使われます。

- `search_resources` や `auto_select_resources` のスコア補正
- 低評価スキルのリファクタ候補抽出
- エージェント信頼度の更新
- 将来の探索戦略や shadow model 評価の材料

## 1. 提案採用ログの学習

対象:

- skills
- tools
- presets

入口ツール:

- `proposal_feedback_learn`

保存先:

- `outputs/tool-proposals/proposal-feedback.jsonl`
- `outputs/tool-proposals/proposal-feedback-model.json`

仕組み:

- 提案ごとに `accepted` / `rejected` を記録します
- reject は `reject_inaccurate`, `reject_unnecessary`, `reject_duplicate` に分解されます
- リソース単位とリソース種別単位で accept / reject 数を集計します
- サンプル数が `minSamples` 以上あるものだけ、次回スコア補正に使います

補正の考え方:

- accept rate は Laplace smoothing つきで計算されます
- サンプル数が多いほど補正の信頼度が上がります
- 補正量は `-0.3` から `+0.3` に制限されます

使われ方:

- `search_resources`
- `auto_select_resources`

## 2. クエリとスキルの相性学習

対象:

- query と skill の組み合わせ

保存先:

- `outputs/tool-proposals/query-skill-feedback.jsonl`
- `outputs/tool-proposals/query-skill-model.json`

仕組み:

- `proposal_feedback_learn` の入力のうち、`resourceType = skills` かつ `topic` があるものを query-skill 学習にも流用します
- query はトークン化され、skill ごとに token weight を蓄積します
- accepted はプラス、rejected はマイナスとして重みづけされます
- skill ごとに `bias` と `tokenWeights` を持つ軽量モデルが更新されます

使われ方:

- `search_resources` / `auto_select_resources` で skill の base score を再補正します

## 3. スキル満足度レーティング学習

入口ツール:

- `record_skill_rating`
- `get_skill_rating_report`

保存先:

- `outputs/reports/skill-rating.jsonl`
- `outputs/reports/skill-rating.json`
- `outputs/reports/skill-rating.md`

仕組み:

- スキル利用後に 1〜5 の rating を記録します
- 全期間平均と直近 window の平均を比較します
- `lowRatingThreshold` 未満、または `trendDropThreshold` 以上の下落がある skill を `flaggedForRefactor` としてマークします

使われ方:

- 低評価スキルや劣化スキルの洗い出し
- 改善優先度付け

## 4. エージェント信頼の学習

入口:

- `agent_ab_test` で `applyOutcomeToTrustStore = true` を指定したとき
- オーケストレーション中の agent feedback

保存先:

- `outputs/agent-trust-histories.json`

仕組み:

- agent ごとに `accepted` / `rejected` の履歴を持ちます
- A/B テストで勝者は accepted、敗者は rejected として反映できます
- オーケストレーションの agent feedback も trust scoring に使われます

使われ方:

- `evaluate_triggers` 時の trust scoring
- 閾値を下回る agent の自動エスカレーション判断

## 5. 自動メモリ / ベクターストア蓄積

関連設定:

- `SF_AI_AUTO_MEMORY=1`

保存先:

- `outputs/memory.jsonl`
- `outputs/vector-store.jsonl`

仕組み:

- ツール実行の input / output サマリを自動追記します
- vector-store には `tool:<name>` タグつきで保存されます
- memory/vector 系ツール自身は再帰防止のため除外されます

使われ方:

- 後続検索の補助
- 運用履歴の再利用

## 6. Bandit と shadow model

関連実装:

- `mcp/core/learning/rl-feedback.ts`
- `mcp/core/learning/model-registry.ts`

概要:

- bandit は resource ごとの success / failure を `Beta(alpha, beta)` として持ち、Thompson sampling で探索と活用のバランスを取ります
- `forcedExplorationRate` により、学習量の少ない arm を意図的に試せます
- model registry は production と shadow version を併走させ、十分な勝率差があれば promote、不調なら rollback できる基盤です

現時点の位置づけ:

- これは今後の高度化や実験の基盤で、日常運用で直接見る主経路は proposal feedback / query-skill / skill-rating / trust の 4 系統です

## 7. 何が自動で学習され、何が手動か

手動入力が中心:

- `proposal_feedback_learn`
- `record_skill_rating`
- `agent_ab_test` の outcome 反映

自動蓄積されるもの:

- `SF_AI_AUTO_MEMORY=1` 時の memory / vector-store
- 実行 provenance と metrics / trace / event 系ログ

半自動:

- オーケストレーション中の trust scoring
- proposal feedback から派生する query-skill 学習

## 8. どこを見ると運用状況が分かるか

- 推薦補正: `outputs/tool-proposals/proposal-feedback-model.json`
- query と skill の相性: `outputs/tool-proposals/query-skill-model.json`
- スキル満足度: `outputs/reports/skill-rating.md`
- エージェント信頼: `outputs/agent-trust-histories.json`
- 自動蓄積メモリ: `outputs/memory.jsonl`, `outputs/vector-store.jsonl`
- どの repo 起点か: `outputs/execution-origins.jsonl`

## 9. 運用上の注意

- これは foundation model の再学習ではなく、ローカルなスコア補正・履歴更新・ランキング改善です
- フィードバックが少ない間は補正が弱く、誤学習の影響も限定されるように上限がかかっています
- `SF_AI_OUTPUTS_DIR` を共通化すると、複数リポジトリをまたいだ学習ログを 1 箇所で管理できます
- リポジトリごとに学習を分けたい場合は、outputs を分離した方が安全です