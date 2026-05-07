# 開発者ガイド

このガイドは、開発・改修時に必要な導線だけをまとめたものです。

## まず読む順番

1. `README.md`
2. `docs/architecture.md`
3. `docs/documentation-map.md`

## ローカル開発

### 最小セットアップ（SQLite + file-based queue）

```bash
npm ci
npm run init
npm run build
npm run ai -- dev
```

### Postgres + pg-boss + PGVector セットアップ（Docker）

```bash
# 依存サービス起動
docker compose up -d postgres ollama

# .env を操作環境向けに切り替え
Copy-Item .env.operations.sample .env

# MCP サーバ起動
npm run ai -- dev
```

### Backend 切り替え方法

`.env` で以下を組み合わせ可能:

```bash
# ローカル開発（既定）
SF_AI_STATE_BACKEND=sqlite
SF_AI_PROPOSAL_QUEUE_BACKEND=file
SF_AI_VECTOR_BACKEND=tfidf

# 運用環境
SF_AI_STATE_BACKEND=postgres
SF_AI_PROPOSAL_QUEUE_BACKEND=pg-boss
SF_AI_VECTOR_BACKEND=pgvector
DATABASE_URL=postgres://sfai:sfai@localhost:5432/sfai
```

## 品質チェック

```bash
npm run typecheck
npm test
npm run metrics:update
npm run metrics:update:drift
npm run ai -- doctor
```

### Backend テスト実行

```bash
# SQLite + file-based queue テスト
npm test -- tests/sqlite-state-store.test.ts tests/persistence-unit-of-work.test.ts

# pg-boss + PGVector テスト（Docker Postgres 起動時のみ）
npm test -- tests/pg-boss-proposal-queue.test.ts tests/pgvector-adapter.test.ts

# 統合テスト（handlers）
npm test -- tests/handlers/handlers-integration.test.ts
```

## 統一CLI（運用・開発共通）

```bash
npm run ai -- dev
npm run ai -- doctor
npm run ai -- outputs:cleanup -- --dry-run
npm run ai -- outputs:version -- backup
npm run ai -- observability:dashboard -- --trace-limit 200 --event-limit 1000
npm run ai -- scaffold -- preset release-readiness-check --agents release-manager,qa-engineer
```

## MCP SDK 更新ランブック

このプロジェクトで `@modelcontextprotocol/sdk` を更新する場合は、次の順序で実施します。

1. 依存更新

```bash
npm outdated @modelcontextprotocol/sdk
npm install @modelcontextprotocol/sdk@latest
```

2. 型差分確認

```bash
npm run typecheck
```

3. 登録層の互換性確認

- `mcp/handlers/register-*.ts` で SDK 型エラーが出ていないことを確認
- `mcp/server.ts` のツール登録と起動フローに破壊的変更がないことを確認

4. 統合テスト

```bash
npm test
```

5. ドキュメント差分反映

- SDK 更新理由と影響を `docs/CHANGELOG.md` の `Unreleased` に追記
- 必要なら `docs/feature-usage-guide.md` と `docs/verification-guide.md` のコマンド例を更新

### 推奨チェックポイント

- 変更前後で `docs/internal/tool-manifest.json` の差分を確認し、意図しないスキーマ変化がないことを確認
- ハンドラー周辺の回帰確認として、少なくとも次を再実行
	- `node --import tsx --test tests/handlers-modules.test.ts`
	- `node --import tsx --test tests/core-tools.test.ts`

### ロールバック手順

- 更新後に互換性問題が出た場合は、直前バージョンを再インストール

```bash
npm install @modelcontextprotocol/sdk@<previous-version>
npm run typecheck
npm test
```

## 主要な実装ポイント

- ツール登録: `mcp/handlers/register-*.ts`
- ツール本体: `mcp/tools/`
- 共通ロジック: `mcp/core/`
- サーバー構成: `mcp/server.ts`

## ドキュメント更新ルール

- 機能仕様は `docs/features/` を優先して更新
- 運用説明は `operations-guide.md` を優先して更新
- 設定変更時は `configuration.md` と `.env.sample` を同時更新
- 履歴は `CHANGELOG.md` に記録

## 検証観点

- 追加ツールは最小1件のテストを追加
- 変更後は `npm run build` と関連テストを実行
- 出力保存仕様を変える場合は `outputs-structure.md` を更新

## エラーハンドリング指針（レイヤー別）

例外処理は「どの層で握り、どの層で返すか」を固定します。闇雲な `try/catch` はデバッグ性を下げるため禁止です。

### 1. bootstrap 層（`mcp/bootstrap.ts`, `mcp/server.ts`）

- 目的: 起動可否の判断とフェイルファスト
- 方針:
	- 起動に必須な失敗（設定欠落、ポート競合、初期化不能）は握りつぶさず終了
	- 代替可能な失敗（任意メトリクス初期化など）は warning ログ + no-op フォールバック
	- 例外メッセージには `error code` を含める

### 2. handler 層（`mcp/handlers/register-*.ts`）

- 目的: 入出力境界での正規化
- 方針:
	- バリデーションエラーはユーザー向けに明確化して返す
	- core 層の例外は catch して文脈（tool 名、主要パラメータ）を付与
	- ただし stack は失わない（`cause` かログで残す）
	- 監査ログ・補助ログ書き込み失敗は本処理を落とさない

### 3. tool 層（`mcp/tools/*.ts`）

- 目的: 外部 I/O 実行の失敗境界
- 方針:
	- 外部コマンド/API は必ず timeout と失敗時メッセージを付ける
	- 再試行する場合は最大回数・バックオフを明示
	- 失敗時は部分結果（取得済み情報）を可能な限り返す

### 4. core 層（`mcp/core/**/*.ts`）

- 目的: ドメインロジックの一貫性維持
- 方針:
	- 純粋関数は原則 throw せず、入力前提を満たさないときのみ throw
	- 永続化層は「致命/非致命」を分離（非致命は no-op 可）
	- catch するなら復旧可能な場合のみ。復旧しない catch は書かない

### 実装ルール（共通）

- `catch (e) {}` の空 catch 禁止
- 同じ例外を多層で重複ログしない（原則 1 回）
- エラー文面は「何が失敗し、次に何を確認すべきか」を含める
- 新規エラーコードを追加した場合は `docs/error-codes.md` へ追記
