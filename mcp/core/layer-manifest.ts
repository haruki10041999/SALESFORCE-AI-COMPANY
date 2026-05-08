/**
 * TASK-F5: core layer manifest.
 *
 * Declares a 4-layer dependency direction for `mcp/core/*` so that imports flow
 * downward: surface -> runtime -> domain -> persistence.
 *
 * The manifest is consumed by `scripts/lint-core-layers.ts` to surface
 * violations in CI while keeping migration incremental.
 */

export type CoreLayer = "persistence" | "domain" | "runtime" | "surface";

/**
 * Layer assignment for every direct child of `mcp/core/`.
 *
 * Rules of thumb:
 *   - persistence: passive readers/writers, schemas, adapters
 *   - domain:      business rules and policy decisions
 *   - runtime:     orchestration, eventing, operational control flow
 *   - surface:     composition and top-level entry coordination
 *
 * Anything not listed defaults to `domain` to fail-soft.
 */
export const CORE_LAYER_MAP: Readonly<Record<string, CoreLayer>> = Object.freeze({
  // persistence layer
  persistence: "persistence",
  io: "persistence",
  config: "persistence",
  types: "persistence",
  declarative: "persistence",
  parsers: "persistence",
  llm: "persistence",
  prompt: "persistence",
  i18n: "persistence",
  trace: "persistence",

  // domain layer
  apex: "domain",
  audit: "domain",
  context: "domain",
  dependency: "domain",
  governance: "domain",
  identity: "domain",
  learning: "domain",
  org: "domain",
  quality: "domain",
  resource: "domain",
  security: "domain",
  skill: "domain",
  registry: "domain",

  // runtime layer
  errors: "runtime",
  event: "runtime",
  logging: "runtime",
  observability: "runtime",
  orchestration: "runtime",
  progress: "runtime",
  recording: "runtime",
  reliability: "runtime",
  server: "runtime",

  // surface layer
  registration: "surface"
});

/** Allowed dependency direction. A layer may import its own tier or any tier listed here. */
export const ALLOWED_LAYER_DEPENDENCIES: Readonly<Record<CoreLayer, readonly CoreLayer[]>> = Object.freeze({
  // Transitional allowance: existing persistence modules still contain read-side
  // projections that depend on domain/runtime helpers.
  persistence: Object.freeze(["persistence", "domain", "runtime"]) as readonly CoreLayer[],
  // Transitional allowance: domain may still depend on runtime modules until
  // migration of shared concerns is complete.
  domain: Object.freeze(["persistence", "domain", "runtime"]) as readonly CoreLayer[],
  runtime: Object.freeze(["persistence", "domain", "runtime"]) as readonly CoreLayer[],
  surface: Object.freeze(["persistence", "domain", "runtime", "surface"]) as readonly CoreLayer[]
});

/** Resolve a `mcp/core/<dir>/...` path to its declared layer. Returns null when outside core. */
export function resolveLayerForCorePath(relativeFromCore: string): CoreLayer | null {
  const normalized = relativeFromCore.replace(/\\/g, "/");
  const segment = normalized.split("/")[0];
  if (!segment) return null;
  const layer = CORE_LAYER_MAP[segment];
  return layer ?? "domain";
}

/** True when `from` may import `to` according to the manifest. */
export function isAllowedLayerEdge(from: CoreLayer, to: CoreLayer): boolean {
  return ALLOWED_LAYER_DEPENDENCIES[from].includes(to);
}
