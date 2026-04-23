# Configuration

This document summarizes runtime environment variables.

| Variable | Purpose | Default |
|---|---|---|
| `SF_AI_OUTPUTS_DIR` | Base output directory for events, history, sessions, governance and generated artifacts | `outputs/` |
| `SF_AI_MEMORY_FILE` | JSONL path for project memory store | `outputs/memory.jsonl` |
| `SF_AI_VECTOR_STORE_FILE` | JSONL path for vector store persistence | `outputs/vector-store.jsonl` |
| `LOG_LEVEL` | Logger verbosity (`error`, `warn`, `info`, `debug`) | `info` |
| `PROMPT_CACHE_MAX_ENTRIES` | Maximum number of prompts to cache in memory | `100` |
| `PROMPT_CACHE_TTL_SECONDS` | Time-to-live for cached prompts in seconds | `60` |

## Prompt Caching

The `buildChatPromptFromContext` function caches built prompts to avoid redundant markdown file I/O. Cache configuration is controlled by two environment variables:

- **`PROMPT_CACHE_MAX_ENTRIES`** (default: `100`): Maximum cache size. When exceeded, the oldest entry is evicted (LRU).
- **`PROMPT_CACHE_TTL_SECONDS`** (default: `60`): Cache entry lifetime. Expired entries are automatically removed on access.

This is particularly useful when the same prompt input is requested multiple times in quick succession.

### Example

```bash
SF_AI_OUTPUTS_DIR=/data/sf-ai/outputs \
SF_AI_MEMORY_FILE=/data/sf-ai/outputs/memory.jsonl \
SF_AI_VECTOR_STORE_FILE=/data/sf-ai/outputs/vector-store.jsonl \
PROMPT_CACHE_MAX_ENTRIES=200 \
PROMPT_CACHE_TTL_SECONDS=120 \
LOG_LEVEL=debug \
npm run mcp:dev
```
