/**
 * Bounded Context Manifest — TASK-14
 *
 * Defines the bounded context (BC) structure for `mcp/contexts/`.
 * Each context owns a slice of the domain; cross-context communication
 * must flow through ports (interfaces in `mcp/core/ports/`) or events.
 *
 * Directory layout:
 *   mcp/contexts/<context>/     — BC root
 *     domain/                   — pure domain logic (entities, value objects, domain services)
 *     application/              — use-case orchestration
 *     infrastructure/           — adapters (DB, external APIs)
 *     index.ts                  — public API barrel (only exports intended as cross-BC surface)
 *
 * Dependency rules:
 *   - A context MAY import from its own layers in any direction internally.
 *   - A context MUST NOT import from another context's internal layers.
 *   - Cross-context imports are only allowed via the context's `index.ts` barrel.
 *   - All shared ports live in `mcp/core/ports/` and are importable by any context.
 */

export type BoundedContext =
  | "identity"
  | "governance"
  | "orchestration"
  | "memory"
  | "learning"
  | "observability"
  | "resource"
  | "cost";

/**
 * Public description of each bounded context.
 */
export const BOUNDED_CONTEXT_REGISTRY: Readonly<Record<BoundedContext, {
  description: string;
  /** Contexts this BC is allowed to depend on (via their index.ts barrel) */
  allowedDependencies: readonly BoundedContext[];
  /** Source directories migrated to this BC (populated incrementally) */
  migratedFrom: readonly string[];
  /** Migration status */
  status: "scaffolded" | "partial" | "complete";
}>> = Object.freeze({
  identity: {
    description: "Actor identity, tenant context, RBAC, and OIDC token verification.",
    allowedDependencies: [],
    migratedFrom: ["mcp/core/identity"],
    status: "complete",
  },
  governance: {
    description: "Policy enforcement, tool governance, audit, and data retention.",
    allowedDependencies: ["identity"],
    migratedFrom: ["mcp/core/governance"],
    status: "partial",
  },
  orchestration: {
    description: "Multi-agent session management, workflow engine, and job scheduling.",
    allowedDependencies: ["identity", "governance"],
    migratedFrom: ["mcp/core/orchestration"],
    status: "partial",
  },
  memory: {
    description: "Vector store, hierarchical memory, knowledge graph, and embedding retrieval.",
    allowedDependencies: ["identity"],
    migratedFrom: ["mcp/core/memory", "memory"],
    status: "partial",
  },
  learning: {
    description: "Feedback loops, bandit algorithms, A/B testing, drift detection, and RL.",
    allowedDependencies: ["identity", "governance", "orchestration"],
    migratedFrom: ["mcp/core/learning"],
    status: "partial",
  },
  observability: {
    description: "Metrics, tracing, dashboards, health checks, and SLO burn tracking.",
    allowedDependencies: ["identity"],
    migratedFrom: ["mcp/core/observability"],
    status: "partial",
  },
  resource: {
    description: "Resource selection, skill rating, proposal management, and tool categorization.",
    allowedDependencies: ["identity", "governance", "learning"],
    migratedFrom: ["mcp/core/resource"],
    status: "partial",
  },
  cost: {
    description: "Cost ledger, budget enforcement, and tenant quota management.",
    allowedDependencies: ["identity", "governance"],
    migratedFrom: ["mcp/core/governance", "mcp/core/reliability"],
    status: "partial",
  },
});

/**
 * Check whether a cross-context import is permitted.
 *
 * @param from - The importing bounded context
 * @param to   - The target bounded context
 * @returns true when the dependency is declared in `allowedDependencies`
 */
export function isCrossContextDependencyAllowed(from: BoundedContext, to: BoundedContext): boolean {
  if (from === to) return true;
  return (BOUNDED_CONTEXT_REGISTRY[from].allowedDependencies as readonly string[]).includes(to);
}
