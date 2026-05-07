# OpenCode / VS Code セットアップ

このドキュメントは、OpenCode または VS Code にこのリポジトリの MCP サーバーを登録する手順を、
「どのファイルを開いて」「どこへ貼るか」が分かる形でまとめたものです。

## 1. 先に見るファイル

まず、このリポジトリ内では次のファイルを開いておきます。

- コピー元の MCP 設定例: [examples/opencode-mcp.example.json](./examples/opencode-mcp.example.json)
- Docker 自動起動付き OpenCode 設定例: [examples/opencode-mcp.with-docker.example.json](./examples/opencode-mcp.with-docker.example.json)
- Docker 自動起動付き VS Code 設定例: [examples/vscode-mcp.with-docker.example.json](./examples/vscode-mcp.with-docker.example.json)
- コピー元の system prompt: [examples/opencode-system-prompt.md](./examples/opencode-system-prompt.md)

OpenCode では MCP 設定と system prompt を、VS Code では MCP 設定を反映するのが基本作業です。

## 2. このリポジトリ側で必要な準備

リポジトリルートで次を実行します。

```powershell
npm ci
npm run init
npm run build
```

`npm run init` を実行すると、次の生成物がそろいます。

- `outputs/` の初期ディレクトリ
- `.env` 雛形（未作成時のみ）
- OpenCode 用の生成済み設定例: `outputs/setup/opencode-mcp.local.json`

このとき使われる主要パスは次のとおりです。

- リポジトリルート: `D:/Projects/mult-agent-ai/salesforce-ai-company`
- 実行ファイル: `D:/Projects/mult-agent-ai/salesforce-ai-company/dist/mcp/server.js`
- 作業ディレクトリ: `D:/Projects/mult-agent-ai/salesforce-ai-company`

補足:

- `dist/mcp/server.js` が無ければ OpenCode から起動できません
- outputs を共通化したい場合は `SF_AI_OUTPUTS_DIR` を絶対パスで指定します
- 例ファイルでは `SF_AI_OUTPUTS_BACKUP_DIR` も指定しています。バックアップ運用をするなら合わせて設定してください
- Docker 依存サービスも自動起動したい場合は [../scripts/start-mcp-with-docker.mjs](../scripts/start-mcp-with-docker.mjs) を MCP 起動コマンドとして使えます

## 3. OpenCode で実際に編集する場所

OpenCode 側で触る場所は通常 2 箇所です。

1. MCP サーバー設定
2. system prompt 設定

OpenCode のバージョン差で UI 名は多少違いますが、基本は次です。

1. OpenCode の設定を開く
2. `MCP` または `Tools` または `External Servers` 付近を開く
3. `Edit Config` または `Open Config File` に相当する操作を選ぶ
4. 開いた設定ファイル、または設定エディタに `salesforce-ai-company` のサーバー定義を追加する

重要なのは「OpenCode 固有の設定ファイルの場所」ではなく、「その中に入れるサーバー定義」です。  
バージョンごとに設定ファイルの保存先が異なるため、このドキュメントでは貼り付ける中身を明示します。

## 3.5 VS Code で実際に編集する場所

VS Code ではワークスペース設定として [../.vscode/mcp.json](../.vscode/mcp.json) を使うのが分かりやすいです。

1. ワークスペースの [../.vscode/mcp.json](../.vscode/mcp.json) を開く
2. `servers.salesforce-ai-company` を追加または更新する
3. VS Code を再読み込みするか MCP サーバー一覧を再読み込みする

このリポジトリでは `servers` 形式を使っています。Docker 自動起動版の例は
[examples/vscode-mcp.with-docker.example.json](./examples/vscode-mcp.with-docker.example.json) を参照してください。

## 4. OpenCode の MCP 設定へ貼る内容

コピー元は [examples/opencode-mcp.example.json](./examples/opencode-mcp.example.json) です。  
OpenCode 側の MCP 設定に、`salesforce-ai-company` エントリを追加してください。

`npm run init` 実行後は、生成済みの `outputs/setup/opencode-mcp.local.json` をそのまま流用して構いません。

Docker 依存サービスも同時に自動起動したい場合は、
[examples/opencode-mcp.with-docker.example.json](./examples/opencode-mcp.with-docker.example.json) をベースにしてください。

### 4.1 `mcpServers` 形式の例

```json
{
  "mcpServers": {
    "salesforce-ai-company": {
      "command": "node",
      "args": [
        "D:/Projects/mult-agent-ai/salesforce-ai-company/dist/mcp/server.js"
      ],
      "cwd": "D:/Projects/mult-agent-ai/salesforce-ai-company",
      "env": {
        "SF_AI_OUTPUTS_DIR": "D:/shared/sf-ai-outputs",
        "SF_AI_OUTPUTS_BACKUP_DIR": "D:/shared/sf-ai-outputs/backups"
      }
    }
  }
}
```

### 4.2 `servers` 形式の例

OpenCode のバージョンによってはトップレベルキーが `servers` の場合があります。  
その場合は同じ中身を次の形で入れます。

```json
{
  "servers": {
    "salesforce-ai-company": {
      "command": "node",
      "args": [
        "D:/Projects/mult-agent-ai/salesforce-ai-company/dist/mcp/server.js"
      ],
      "cwd": "D:/Projects/mult-agent-ai/salesforce-ai-company",
      "env": {
        "SF_AI_OUTPUTS_DIR": "D:/shared/sf-ai-outputs",
        "SF_AI_OUTPUTS_BACKUP_DIR": "D:/shared/sf-ai-outputs/backups"
      }
    }
  }
}
```

### 4.3 パスで迷いやすい点

- `command` は `node`
- `args[0]` はこのリポジトリのビルド済みファイル `dist/mcp/server.js`
- `cwd` はこのリポジトリのルートフォルダ
- `SF_AI_OUTPUTS_DIR` は任意。共有出力が不要なら削除しても構いません
- パス区切りは Windows では `/` でも動作します

### 4.4 Docker 依存サービスも自動起動する例

OpenCode でも VS Code でも、MCP サーバーの `command` / `args` に
[../scripts/start-mcp-with-docker.mjs](../scripts/start-mcp-with-docker.mjs) を指定すれば、
`docker compose up -d postgres ollama` を先に実行してから MCP サーバーを起動できます。

```json
{
  "mcpServers": {
    "salesforce-ai-company": {
      "command": "node",
      "args": [
        "D:/Projects/mult-agent-ai/salesforce-ai-company/scripts/start-mcp-with-docker.mjs",
        "--",
        "node",
        "dist/mcp/server.js"
      ],
      "cwd": "D:/Projects/mult-agent-ai/salesforce-ai-company",
      "env": {
        "SF_AI_OUTPUTS_DIR": "D:/shared/sf-ai-outputs",
        "SF_AI_OUTPUTS_BACKUP_DIR": "D:/shared/sf-ai-outputs/backups"
      }
    }
  }
}
```

このラッパースクリプトは次を行います。

- `docker compose up -d postgres ollama`
- `docker compose config --services` で存在するサービスだけ起動
- `docker compose ps --format json` の状態確認
- `localhost:5432` と `localhost:11434` の待機
- その後に `node dist/mcp/server.js` を起動

主な環境変数:

- `SF_AI_DOCKER_SERVICES`: 起動対象サービス。既定 `postgres,ollama`
- `SF_AI_DOCKER_PROFILE`: 例 `observability`
- `SF_AI_WAIT_FOR_PORTS`: 待機対象ポート。既定 `5432,11434`
- `SF_AI_DOCKER_WAIT_TIMEOUT_MS`: 待機タイムアウト ms。既定 `120000`
- `SF_AI_SKIP_DOCKER_BOOTSTRAP=true`: Docker 起動をスキップ

注意:

- ラッパーは Docker サービスを `up -d` するだけで、自動停止はしません
- 現在の compose に存在しないサービス名は自動的にスキップします
- Docker ログは MCP の stdout を壊さないよう stderr に出力します
- `npx tsx mcp/server.ts` で直接起動したい場合は `-- node dist/mcp/server.js` の部分を `-- npx tsx mcp/server.ts` に置き換えます

### 4.5 VS Code 用の Docker 自動起動例

[../.vscode/mcp.json](../.vscode/mcp.json) に入れる場合の例です。

```json
{
  "servers": {
    "salesforce-ai-company": {
      "type": "stdio",
      "command": "node",
      "args": [
        "${workspaceFolder}/scripts/start-mcp-with-docker.mjs",
        "--",
        "node",
        "dist/mcp/server.js"
      ],
      "cwd": "${workspaceFolder}"
    }
  }
}
```

開発中に TypeScript 直起動したい場合は、`dist/mcp/server.js` を `npx`, `tsx`, `mcp/server.ts` に差し替えます。

## 5. `tsx` で直接起動したい場合

build 済みの `dist/mcp/server.js` を使わず、TypeScript を直接起動する場合は次に変えます。

```json
{
  "mcpServers": {
    "salesforce-ai-company": {
      "command": "npx",
      "args": [
        "tsx",
        "D:/Projects/mult-agent-ai/salesforce-ai-company/mcp/server.ts"
      ],
      "cwd": "D:/Projects/mult-agent-ai/salesforce-ai-company"
    }
  }
}
```

通常は build 済みの `dist/mcp/server.js` を使うほうが分かりやすいです。

## 6. system prompt に貼る内容

Copilot では [../.github/copilot-instructions.md](../.github/copilot-instructions.md) が自動適用されますが、OpenCode では通常そうなりません。

そのため、[examples/opencode-system-prompt.md](./examples/opencode-system-prompt.md) を開いて、中身を OpenCode 側の system prompt 設定欄へそのまま貼り付けてください。

OpenCode 側でやること:

1. Settings を開く
2. `System Prompt` または `Assistant Instructions` に相当する欄を開く
3. [examples/opencode-system-prompt.md](./examples/opencode-system-prompt.md) の本文を貼る
4. 保存する

このテンプレートには次が入っています。

- 通常依頼では `smart_chat` を優先
- agents / skills / personas / file paths 明示時は `chat`
- エージェント連携は `orchestrate_chat` から開始
- 会話保存では `parse_and_record_chat` を優先
- 再利用ワークフローは `create_preset` と `run_preset`

## 7. 最初の疎通確認

設定を保存したら、OpenCode を再読み込みするか、MCP サーバー一覧を再読込します。  
その後、OpenCode から順に次を試します。

1. `list_agents を実行して`
2. `list_skills を実行して`
3. `metrics_summary を呼び出して直近の状態を見せて`

この 3 つが通れば、MCP 接続と主要カテゴリの読み込みは概ね正常です。

確認ポイント:

- `salesforce-ai-company` が `connected` または `ready` になっている
- `ENOENT` や `dist/mcp/server.js not found` が出ていない
- ツール実行時に結果が返る

## 8. よくあるつまずき

### 8.1 `dist/mcp/server.js not found`

原因:

- build 前
- `args` のパスが違う

対処:

```powershell
npm run build
```

その上で、OpenCode の設定にある `args` のパスを見直します。

### 8.2 MCP サーバーは見えるが接続できない

原因:

- `cwd` が違う
- `node` が PATH に無い
- JSON のトップレベルキーが OpenCode の期待形式と違う

対処:

- `cwd` を `D:/Projects/mult-agent-ai/salesforce-ai-company` に合わせる
- `command` が `node` で実行できるか確認する
- `mcpServers` 形式でだめなら `servers` 形式でも試す

### 8.3 system prompt を入れたのに期待どおりに動かない

原因:

- prompt を保存していない
- OpenCode 再読み込み前の状態を見ている
- MCP ツール自体が未接続

対処:

- system prompt を再保存する
- OpenCode を再読み込みする
- 先に `list_agents` が通るか確認する

## 9. このリポジトリ内で参照するファイルまとめ

- MCP 設定のコピー元: [examples/opencode-mcp.example.json](./examples/opencode-mcp.example.json)
- Docker 自動起動版の MCP 設定例: [examples/opencode-mcp.with-docker.example.json](./examples/opencode-mcp.with-docker.example.json)
- VS Code 用の Docker 自動起動設定例: [examples/vscode-mcp.with-docker.example.json](./examples/vscode-mcp.with-docker.example.json)
- system prompt のコピー元: [examples/opencode-system-prompt.md](./examples/opencode-system-prompt.md)
- ビルド後の実行ファイル: [../dist/mcp/server.js](../dist/mcp/server.js)
- Docker 自動起動ラッパー: [../scripts/start-mcp-with-docker.mjs](../scripts/start-mcp-with-docker.mjs)
- VS Code ワークスペース設定: [../.vscode/mcp.json](../.vscode/mcp.json)
- 検証手順: [full-feature-verification.md](./full-feature-verification.md)

## 10. 関連ドキュメント

- [full-feature-verification.md](./full-feature-verification.md)
- [configuration.md](./configuration.md)
- [outputs-structure.md](./outputs-structure.md)
- [learning-guide.md](./learning-guide.md)
