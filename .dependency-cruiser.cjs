/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-handlers-to-memory",
      comment: "handlers must not directly import memory layer",
      severity: "error",
      from: { path: "^mcp/handlers/" },
      to: { path: "^memory/" }
    },
    {
      name: "no-handlers-to-learning",
      comment: "handlers must not directly import core learning",
      severity: "error",
      from: { path: "^mcp/handlers/" },
      to: { path: "^mcp/core/learning/" }
    },
    {
      name: "no-core-to-handlers",
      comment: "core layer must not import handlers",
      severity: "error",
      from: { path: "^mcp/core/" },
      to: { path: "^mcp/handlers/" }
    },
    {
      name: "no-domain-to-infrastructure",
      comment: "domain should not directly import infrastructure",
      severity: "error",
      from: { path: "^mcp/core/domain/" },
      to: { path: "^mcp/infrastructure/" }
    },
    {
      name: "no-learning-process-env",
      comment: "learning layer should use runtime-config/env helpers",
      severity: "error",
      from: { path: "^mcp/core/learning/" },
      to: { path: "process" }
    },
    // -----------------------------------------------------------------------
    // Bounded Context rules (TASK-14)
    // -----------------------------------------------------------------------
    {
      name: "no-cross-context-internal-import",
      comment: "Contexts must not import internal modules of other contexts — use the context's index.ts barrel only.",
      severity: "warn",
      from: { path: "^mcp/contexts/([^/]+)/" },
      to: {
        path: "^mcp/contexts/",
        // Allow imports from own context or index barrels of other contexts
        pathNot: [
          "^mcp/contexts/$1/",           // own context
          "^mcp/contexts/[^/]+/index\\.ts$"  // another context's barrel
        ]
      }
    },
    {
      name: "no-core-imports-from-contexts-internals",
      comment: "mcp/core must not import from mcp/contexts internals (only via barrel index).",
      severity: "warn",
      from: { path: "^mcp/core/" },
      to: {
        path: "^mcp/contexts/",
        pathNot: "^mcp/contexts/[^/]+/index\\.ts$"
      }
    },
    {
      name: "no-handlers-bypass-contexts",
      comment: "Handlers should prefer mcp/contexts/ barrels over mcp/core/ for migrated BCs.",
      severity: "info",
      from: { path: "^mcp/handlers/" },
      to: { path: "^mcp/core/identity/" }
    }
  ],
  options: {
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "default", "node"]
    },
    doNotFollow: { path: "node_modules" },
    exclude: {
      path: "(^dist/|^outputs/)"
    },
    reporterOptions: {
      dot: { collapsePattern: "node_modules/[^/]+" }
    }
  }
};