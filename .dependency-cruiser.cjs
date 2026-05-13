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