# Replay Determinism Contract

## Scope

This contract defines what is deterministic during replay and what requires explicit cache-backed control.

## Deterministic In Replay

- Event-store reads from persisted immutable events.
- Derived timeline/diff calculations over stored payloads.
- Tool recording playback when inputs and recorded outputs are identical.

## Non-Deterministic Without Controls

- Live LLM calls (provider/model drift, sampling, backend changes).
- Wall-clock dependent side effects.
- External API/network side effects.

## Replay Modes

- observe:
  - Replay proceeds even when LLM cache miss occurs.
  - Misses can call live LLM and write-through cache.
- strict:
  - Replay requires LLM cache hit for LLM completions.
  - Cache miss fails replay immediately.

## LLM Cache Key

Cache key is computed as:

- hash(prompt) + adapter + version + hash(params)

Implementation in this repo:

- [mcp/infrastructure/llm/llm-cache-postgres.ts](mcp/infrastructure/llm/llm-cache-postgres.ts)

## Environment Controls

- SF_AI_REPLAY_MODE=observe|strict
- SF_AI_REPLAY_REQUIRE_LLM_CACHE_HIT=true|false

Compatibility note:

- Existing execution-recording modes `passthrough|record|replay` are still accepted.
- Determinism behavior (cache strictness / outbox dispatch suppression) is activated by `SF_AI_REPLAY_MODE=strict`.

## Outbox Behavior During Replay

- Replay paths should avoid direct side effects.
- Side effects are represented as outbox messages where possible.
- Outbox dispatch can be disabled or deferred in strict replay operations.
