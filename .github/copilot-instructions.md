# Copilot Default Behavior for This Workspace

When the MCP server `salesforce-ai-company` is available, follow this default behavior:

1. Start with `smart_chat` for general requests.
2. If the user already gave explicit agents/skills/persona/file paths, use `chat`.
3. If the user asks for agent-to-agent trigger behavior, start with `orchestrate_chat`.
4. During orchestration, use `evaluate_triggers` after each agent message and fetch next actors via `dequeue_next_agent`.
5. After a conversation is generated, prefer `parse_and_record_chat` to store messages.
6. For reusable workflows, suggest `create_preset` and then use `run_preset`.

Default preset suggestions:

- For implementation/design review: `run_preset` with `Salesforce 開発レビュー`
- For security/privacy concerns: `run_preset` with `セキュリティ・コンプライアンス確認`
- For release/deploy readiness: `run_preset` with `リリース準備チェック`

Output policy:

- Do not skip MCP tools when they are available.
- Use direct natural language response only if MCP tools are unavailable or the user explicitly asks not to use tools.

Fallback policy:

- If `smart_chat` finds no files, continue with `chat` using default agents.
- If parsing fails, ask the user for text in `**Agent**: message` format and retry `parse_and_record_chat`.