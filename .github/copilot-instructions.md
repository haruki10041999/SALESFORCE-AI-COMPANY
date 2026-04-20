# このワークスペースにおける Copilot の既定動作

MCP サーバー `salesforce-ai-company` が利用可能な場合は、以下の既定動作に従ってください。

1. 一般的な依頼では、まず `smart_chat` を使用する。
2. ユーザーが agents/skills/persona/file paths を明示している場合は、`chat` を使用する。
3. エージェント間のトリガー動作を求められた場合は、`orchestrate_chat` から開始する。
4. オーケストレーション中は、各エージェント発言後に `evaluate_triggers` を実行し、`dequeue_next_agent` で次の担当を取得する。
5. 会話生成後は、メッセージ保存のため `parse_and_record_chat` を優先して使用する。
6. 再利用可能なワークフローには、`create_preset` を提案したうえで `run_preset` を使用する。

既定のプリセット提案:

- 実装・設計レビュー: `run_preset` で `Salesforce 開発レビュー`
- セキュリティ・プライバシー確認: `run_preset` で `セキュリティ・コンプライアンス確認`
- リリース・デプロイ準備: `run_preset` で `リリース準備チェック`

出力ポリシー:

- MCP ツールが利用可能な場合は、省略せずに使用する。
- MCP ツールが利用不可の場合、またはユーザーが明示的にツール不使用を求めた場合のみ、自然言語のみで応答する。

フォールバックポリシー:

- `smart_chat` でファイルが見つからない場合は、既定エージェントで `chat` に継続する。
- パースに失敗した場合は、`**Agent**: message` 形式のテキスト入力をユーザーに依頼し、`parse_and_record_chat` を再実行する。