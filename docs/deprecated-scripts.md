# Deprecated Scripts

実運用では不要になった npm run タスクを記載します。必要に応じて `package.json` で復活できます。

## 削除したタスク一覧

| コマンド | 対応スクリプト | 代替案 / 理由 |
|---|---|---|
| `npm run guard:precommit` | scripts/pre-commit.js | `npm run init` で自動導入済み。手動実行は不要 |
| `npm run hooks:install` | scripts/install-git-hooks.js | `npm run init` に統合済み |
| `npm run lint:core-layers` | scripts/lint-core-layers.ts | 開発初期に有用だがCI では不要 |
| `npm run skills:classify` | scripts/skill-auto-classify.ts | 学習フレームワークの実装待ち |
| `npm run tools:catalog` | scripts/extract-tool-names.ts | tool discovery は MCP 側で実施 |
| `npm run docs:config` | scripts/generate-config-doc.ts | 環境設定は docs/ に手動記載 |
| `npm run docs:manifest` | scripts/generate-tool-manifest.ts | proposal/applier が自動管理 |
| `npm run tools:compat` | scripts/check-tool-compatibility.ts | TypeScript typecheck で十分 |
| `npm run metrics:snapshot` | scripts/metrics-snapshot.js | report:metrics で取得可能 |
| `npm run metrics:seed` | scripts/seed-metrics.js | テスト用。本番では不要 |
| `npm run metrics:dashboard` | scripts/metrics-dashboard.js | observability へ統合予定 |
| `npm run metrics:sla-archive` | scripts/metrics-sla-archive.ts | SLA トラッキングは Phase 2 以降 |
| `npm run sla:dashboard` | scripts/sla-dashboard.js | 上に同じ |
| `npm run observability:dashboard` | scripts/observability-dashboard.ts | 観測可視化は MCP dashboard で提供 |
| `npm run benchmark:run` | scripts/benchmark-suite.ts | 性能測定は CI で不要 |
| `npm run tail:progress` | scripts/tail-progress.ts | ローカル開発時のログ追跡。本番不要 |
| `npm run test:matrix` | scripts/test-matrix.ts | クロスコンビネーションテスト。npm test で十分 |
| `npm run test:selective` | scripts/run-selective-tests.ts | npm test -- --grep で代用可能 |
| `npm run outputs:version` | scripts/outputs-version.ts | versioning は UoW (atomic-write) で自動 |
| `npm run learning:replay` | scripts/learning-replay.ts | オフライン学習。本番では実行不要 |
| `npm run state:migrate-sqlite` | scripts/migrate-jsonl-to-sqlite.ts | JSONL から SQLite への migration は不要 |
| `npm run state:export-jsonl` | scripts/state-export-jsonl.ts | アーカイブは archive:history で取得 |

## 復活方法

削除したタスクが必要になった場合、`package.json` の `scripts` セクションに戻す:

```json
{
  "scripts": {
    "...": "...",
    "tools:compat": "tsx scripts/check-tool-compatibility.ts",
    "metrics:snapshot": "node scripts/metrics-snapshot.js"
  }
}
```

その後 `npm run ci` で型チェック・テストが通ることを確認してください。
