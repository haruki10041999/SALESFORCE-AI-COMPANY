# Configuration

This document summarizes runtime environment variables.

| Variable | Purpose | Default |
|---|---|---|
| `SF_AI_OUTPUTS_DIR` | Base output directory for events, history, sessions, governance and generated artifacts | `outputs/` |
| `SF_AI_MEMORY_FILE` | JSONL path for project memory store | `outputs/memory.jsonl` |
| `SF_AI_VECTOR_STORE_FILE` | JSONL path for vector store persistence | `outputs/vector-store.jsonl` |
| `LOG_LEVEL` | Logger verbosity (`error`, `warn`, `info`, `debug`) | `info` |

## Example

```bash
SF_AI_OUTPUTS_DIR=/data/sf-ai/outputs \
SF_AI_MEMORY_FILE=/data/sf-ai/outputs/memory.jsonl \
SF_AI_VECTOR_STORE_FILE=/data/sf-ai/outputs/vector-store.jsonl \
LOG_LEVEL=debug \
npm run mcp:dev
```
