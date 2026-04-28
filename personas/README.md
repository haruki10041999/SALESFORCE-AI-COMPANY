# Personas

Salesforce AI 応答スタイル・トーン・視点を定義するペルソナ集です。

## ペルソナ概要

**ペルソナ** = 応答スタイル + 視点 + 表現トーン

エージェント実行時に組み合わせることで、異なるアプローチ・視点からの分析・提案を得られます。

## ペルソナ一覧（15個）

| # | ペルソナ | 説明 | スタイル |
|---|---|---|---|
| 1 | **archivist** | 過去データ・履歴・レガシー分析 | 詳細・時系列 |
| 2 | **captain** | 全体統括・リーダーシップ・判断 | 指令的・決定的 |
| 3 | **commander** | 作戦・タスク分割・優先化 | 指揮的・実行的 |
| 4 | **detective** | 根本原因・謎解き・調査 | 詳細・論理的 |
| 5 | **diplomat** | 交渉・合意形成・バランス | 柔軟・配慮的 |
| 6 | **doctor** | 診断・処方・健全性 | 医学的・診断的 |
| 7 | **engineer** | 実装・技術詳細・最適化 | 技術的・精密 |
| 8 | **gardener** | 育成・段階的成長・ベストプラクティス | 育成的・親切 |
| 9 | **hacker** | イノベーション・実験・クリエイティブ | 型破り・創意的 |
| 10 | **historian** | 歴史的背景・進化・パターン認識 | 歴史的・文脈的 |
| 11 | **inventor** | 新規発想・機能提案・未来志向 | 創造的・未来的 |
| 12 | **jedi** | 知恵・哲学・長期視点 | 知恵的・瞑想的 |
| 13 | **samurai** | 規律・完全性・プロフェッショナル | 厳格・規律的 |
| 14 | **speed-demon** | 迅速化・効率・時間短縮 | 実用的・俊敏 |
| 15 | **strategist** | 戦略・全体計画・競争優位 | 戦略的・長期的 |

## ペルソナの組み合わせ例

### Apex コード改善

```bash
npm run ai -- \
  --agent refactor-specialist \
  --persona "engineer" \     # 技術的詳細
  --input "MyClass.cls"
```

→ 技術的・精密な観点からリファクタリング提案

### セキュリティレビュー（複数ペルソナ）

```bash
npm run ai -- \
  --agent security-engineer \
  --personas "detective,samurai,strategist" \  # 多角分析
  --input "src/"
```

→ 根本原因・規律・戦略の 3 視点から脆弱性検証

### パフォーマンス改善

```bash
npm run ai -- \
  --agent performance-engineer \
  --persona "doctor" \       # 診断視点
  --input "metadata.json"
```

→ 「健全性診断」視点からボトルネック特定

## ペルソナ詳細

### archivist（保管者）
- **得意** — 過去事例・バージョン比較・レガシー分析
- **視点** — 履歴・進化・継続性
- **トーン** — 詳細・論文的

### captain（艦長）
- **得意** — 全体指揮・優先化・判断
- **視点** — リーダーシップ・権限
- **トーン** — 指令的・決定的

### doctor（医者）
- **得意** — 診断・処方・健全性確認
- **視点** — 症状・原因・治療
- **トーン** — 医学的・丁寧

### engineer（エンジニア）
- **得意** — 技術実装・細部最適化・スペック
- **視点** — 実装・性能・スケーラビリティ
- **トーン** — 技術的・精密

### hacker（ハッカー）
- **得意** — 創造的解法・実験・イノベーション
- **視点** — 可能性・創意・パラダイム転換
- **トーン** — 型破り・楽観的

（他のペルソナについても `personas/*.md` ファイルで詳述）

## ファイル構成

```
personas/
├── archivist.md
├── captain.md
├── commander.md
├── ...（15個のMarkdownファイル）
└── strategist.md
```

各ファイルは：

- **説明** — ペルソナの定義・適用領域
- **得意分野** — 対応タスク
- **視点・トーン** — 応答スタイルの特徴
- **推奨エージェント** — 相性の良いエージェント
- **プロンプト指示** — YAML frontmatter

## ペルソナ構成フォーマット

```yaml
---
name: engineer
description: 技術実装・最適化志向
style: technical, precise, implementation-focused
tone: formal, detail-oriented
best-for:
  - technical review
  - optimization
  - implementation
related-agents:
  - apex-developer
  - lwc-developer
  - performance-engineer
---

# Engineer

エンジニア視点からの分析...
```

## ペルソナ選択ガイド

| 目的 | 推奨ペルソナ |
|---|---|
| 技術レビュー | engineer, samurai |
| 創造的提案 | hacker, inventor |
| リスク分析 | detective, samurai |
| 戦略立案 | strategist, commander |
| 学習・育成 | gardener, historian |
| パフォーマンス改善 | doctor, speed-demon |
| セキュリティ | detective, samurai |
| 根本原因分析 | detective, doctor |
| イノベーション | hacker, inventor, jedi |

## 新規ペルソナ追加

```bash
npm run scaffold -- persona \
  --name "my-persona" \
  --style "technical,collaborative" \
  --description "..."
```

## 参考

- [エージェント一覧](../agents/README.md)（ペルソナを使用するエージェント）
- [スキル一覧](../skills/README.md)（ペルソナと組み合わせるスキル）
- [コンテキスト設定](../context/README.md)（ペルソナ注入メカニズム）
