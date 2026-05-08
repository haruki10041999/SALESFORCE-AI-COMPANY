/**
 * Surface layer facade.
 *
 * Provides top-level MCP server composition helpers.
 */

export { initializeServerRuntime } from "../bootstrap.js";
export { registerServerTools } from "../tool-registry.js";
export { startMcpTransport } from "../transport.js";
export { runWithLifecycle } from "../lifecycle.js";
