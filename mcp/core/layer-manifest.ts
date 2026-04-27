/**
 * TASK-F5: core layer manifest.
 *
 * Declares a 3-tier dependency direction for `mcp/core/*` so that imports flow
 * strictly downward: observable -> logic -> data. The manifest is consumed by
 * `scripts/lint-core-layers.ts` to surface violations in CI without forcing a
 * disruptive directory move. When directories are eventually relocated, only
 * this map needs to be updated.
 */

export type CoreLayer = "data" | "logic" | "observable";

/**
 * Layer assignment for every direct child of `mcp/core/`.
 *
 * Rules of thumb:
 *   - data:       passive readers/writers, schemas, type definitions
 *   - logic:      decision-making units that read data and produce events
 *   - observable: side-effect emitters, dashboards, traces, logs
 *
 * Anything not listed defaults to `logic` to fail-soft.
 */
export const CORE_LAYER_MAP: Readonly<Record<string, CoreLayer>> = Object.freeze({
  // data tier: passive utilities, schemas, types, cross-cutting helpers
  types: "data",
  config: "data",
  resource: "data",
  skill: "data",
  // Declarative tool spec is a passive zod schema + loader for JSON tool
  // definitions. It belongs to the data tier so other tiers may import it.
  declarative: "data",
  // F-04: prompt utilities (injection guard / quality rubric / template).
  // Pure helpers with no side effects beyond returning new strings.
  prompt: "data",
  // T-OLLAMA-01: HTTP client for local Ollama server. Stateless adapter that
  // wraps fetch with retry/timeout. No business decisions live here.
  llm: "data",
  // F-08/F-09: AST parsers (Apex via @apexdevtools/apex-parser, Flow via
  // fast-xml-parser). Pure parser modules with no side effects.
  parsers: "data",
  // Logger / PII masker / progress formatter / trace context act as
  // cross-cutting utilities that any layer may import without coupling
  // upstream business logic, so they are pinned to the data tier.
  logging: "data",
  trace: "data",
  progress: "data",
  // i18n is a passive lookup of locale + message templates.
  i18n: "data",

  // logic tier: decision-making units that read data and may emit events
  context: "logic",
  governance: "logic",
  quality: "logic",
  learning: "logic",
  orchestration: "logic",
  errors: "logic",

  // observable tier: side-effect emitters and aggregation entry points
  event: "observable",
  observability: "observable",
  registration: "observable"
});

/** Allowed dependency direction. A layer may import its own tier or any tier listed here. */
export const ALLOWED_LAYER_DEPENDENCIES: Readonly<Record<CoreLayer, readonly CoreLayer[]>> = Object.freeze({
  data: Object.freeze(["data"]) as readonly CoreLayer[],
  logic: Object.freeze(["data", "logic"]) as readonly CoreLayer[],
  observable: Object.freeze(["data", "logic", "observable"]) as readonly CoreLayer[]
});

/** Resolve a `mcp/core/<dir>/...` path to its declared layer. Returns null when outside core. */
export function resolveLayerForCorePath(relativeFromCore: string): CoreLayer | null {
  const normalized = relativeFromCore.replace(/\\/g, "/");
  const segment = normalized.split("/")[0];
  if (!segment) return null;
  const layer = CORE_LAYER_MAP[segment];
  return layer ?? "logic";
}

/** True when `from` may import `to` according to the manifest. */
export function isAllowedLayerEdge(from: CoreLayer, to: CoreLayer): boolean {
  return ALLOWED_LAYER_DEPENDENCIES[from].includes(to);
}
