import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveMcpTransportKind } from "../mcp/transport.js";

test("resolveMcpTransportKind defaults to stdio", () => {
  const kind = resolveMcpTransportKind({} as NodeJS.ProcessEnv);
  assert.equal(kind, "stdio");
});

test("resolveMcpTransportKind resolves http", () => {
  const kind = resolveMcpTransportKind({ MCP_TRANSPORT: "http" } as NodeJS.ProcessEnv);
  assert.equal(kind, "http");
});

test("resolveMcpTransportKind rejects unknown value", () => {
  assert.throws(
    () => resolveMcpTransportKind({ MCP_TRANSPORT: "grpc" } as NodeJS.ProcessEnv),
    /MCP_TRANSPORT must be either 'stdio' or 'http'/
  );
});
