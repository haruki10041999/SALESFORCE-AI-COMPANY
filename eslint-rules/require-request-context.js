const OUTPUT_METHODS = new Set(["writeArtifact", "appendEvent", "readArtifact"]);
const OBSERVABILITY_METHODS = new Set(["recordEvent"]);
const COST_METHODS = new Set(["record"]);
const MEMORY_METHODS = new Set(["add", "search", "list", "clear"]);

function isLikelyRequestContext(node) {
  if (!node) {
    return false;
  }
  if (node.type === "Identifier") {
    return node.name === "ctx" || node.name.endsWith("Context");
  }
  if (node.type === "CallExpression" && node.callee.type === "Identifier") {
    return node.callee.name === "getRequestContext" || node.callee.name === "requireRequestContext";
  }
  if (node.type === "ObjectExpression") {
    const keys = new Set(
      node.properties
        .filter((property) => property.type === "Property" && property.key.type === "Identifier")
        .map((property) => property.key.name)
    );
    return keys.has("tenantId") && keys.has("actorId") && keys.has("traceId");
  }
  return false;
}

function shouldCheck(objectName, methodName) {
  if (!objectName || !methodName) {
    return false;
  }
  if (objectName === "outputsPort" && OUTPUT_METHODS.has(methodName)) {
    return true;
  }
  if (objectName === "observability" && OBSERVABILITY_METHODS.has(methodName)) {
    return true;
  }
  if (objectName === "costLedger" && COST_METHODS.has(methodName)) {
    return true;
  }
  if (objectName === "memoryService" && MEMORY_METHODS.has(methodName)) {
    return true;
  }
  return false;
}

const requireRequestContextRule = {
  meta: {
    type: "problem",
    docs: {
      description: "require RequestContext as first argument for port calls",
      recommended: false
    },
    schema: [],
    messages: {
      missingContext: "Pass RequestContext as the first argument for port method '{{method}}'."
    }
  },
  create(context) {
    const normalizedFilename = String(context.filename ?? "").replace(/\\/g, "/");
    if (normalizedFilename.endsWith("/mcp/core/runtime/with-context.ts")) {
      return {};
    }

    return {
      CallExpression(node) {
        if (node.callee.type !== "MemberExpression" || node.callee.computed) {
          return;
        }
        if (node.callee.property.type !== "Identifier") {
          return;
        }
        const methodName = node.callee.property.name;
        const objectName = node.callee.object.type === "Identifier" ? node.callee.object.name : undefined;

        if (!shouldCheck(objectName, methodName)) {
          return;
        }

        const firstArg = node.arguments[0];
        if (!isLikelyRequestContext(firstArg)) {
          context.report({
            node,
            messageId: "missingContext",
            data: { method: methodName }
          });
        }
      }
    };
  }
};

export default {
  rules: {
    "require-request-context": requireRequestContextRule
  }
};
