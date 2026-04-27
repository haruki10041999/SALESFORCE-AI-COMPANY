# OpenCode セットアップ

このリポジトリは stdio で起動する MCP サーバーなので、OpenCode が外部 MCP サーバーを登録できる環境であれば利用できます。

## 1. 前提

```powershell
npm ci
npm run build
```

- 実行ファイルは `dist/mcp/server.js`
- 直接起動時のワーキングディレクトリはリポジトリルート
- outputs を別リポジトリと共通化したい場合は `SF_AI_OUTPUTS_DIR` を絶対パスで指定

## 2. MCP 設定例

[examples/opencode-mcp.example.json](./examples/opencode-mcp.example.json) をベースに、OpenCode の MCP 設定へ反映します。

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
        "SF_AI_OUTPUTS_DIR": "D:/shared/sf-ai-outputs"
      }
    }
  }
}
```

注意:

- OpenCode のバージョンによってはトップレベルキーが `servers` の場合があります。
- その場合でも各サーバー定義に必要な値は `command`、`args`、`cwd`、`env` です。
- `tsx` で直接起動する場合は `command` を `npx`、`args` を `tsx`, `.../mcp/server.ts` に置き換えます。

## 3. system prompt の移植

Copilot では [../.github/copilot-instructions.md](../.github/copilot-instructions.md) が自動適用されますが、OpenCode では通常そうなりません。

そのため、[examples/opencode-system-prompt.md](./examples/opencode-system-prompt.md) の内容を OpenCode 側の system prompt に入れてください。

このテンプレートには次を移植しています。

- 通常依頼では `smart_chat` を優先
- agents / skills / personas / file paths 明示時は `chat`
- エージェント連携は `orchestrate_chat` から開始
- 会話保存では `parse_and_record_chat` を優先
- 再利用ワークフローは `create_preset` と `run_preset`

## 4. 最初の疎通確認

OpenCode から順に次を試します。

1. `list_agents を実行して`
2. `list_skills を実行して`
3. `metrics_summary を呼び出して直近の状態を見せて`

この 3 つが通れば、MCP 接続と主要カテゴリの読み込みは概ね正常です。

## 5. よくある差分

- Copilot はワークスペースの instructions を自動で読むが、OpenCode は明示設定が必要
- Claude Desktop / OpenCode / Copilot で UI 上のツール名や承認フローは異なる
- outputs の保存場所はクライアントではなくサーバー環境変数で決まる
- 実行元リポジトリの記録は `outputs/execution-origins.jsonl` に残る

## 6. 関連ドキュメント

- [full-feature-verification.md](./full-feature-verification.md)
- [configuration.md](./configuration.md)
- [outputs-structure.md](./outputs-structure.md)
- [learning-guide.md](./learning-guide.md)
