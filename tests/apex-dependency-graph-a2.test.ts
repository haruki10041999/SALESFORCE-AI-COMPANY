import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApexDependencyGraph } from "../mcp/tools/apex-dependency-graph.js";

function makeFixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "apex-dep-a2-"));
  mkdirSync(join(root, "classes"), { recursive: true });
  mkdirSync(join(root, "flows"), { recursive: true });
  mkdirSync(join(root, "permissionsets"), { recursive: true });

  // Apex classes: AccountService -> AccountSelector ; CalloutService is integration
  writeFileSync(
    join(root, "classes", "AccountService.cls"),
    `public class AccountService { public void run() { AccountSelector s = new AccountSelector(); } }`,
    "utf-8"
  );
  writeFileSync(
    join(root, "classes", "AccountSelector.cls"),
    `public class AccountSelector { public void q() {} }`,
    "utf-8"
  );
  writeFileSync(
    join(root, "classes", "CalloutService.cls"),
    `public class CalloutService {
       public void send() {
         HttpRequest req = new HttpRequest();
         req.setEndpoint('callout:MyEndpoint/v1');
       }
     }`,
    "utf-8"
  );

  // Flow referencing AccountService
  writeFileSync(
    join(root, "flows", "OrderFlow.flow-meta.xml"),
    `<?xml version="1.0"?>
     <Flow>
       <actionCalls><actionName>AccountService</actionName></actionCalls>
     </Flow>`,
    "utf-8"
  );

  // Permission set granting access to CalloutService
  writeFileSync(
    join(root, "permissionsets", "MyPS.permissionset-meta.xml"),
    `<?xml version="1.0"?>
     <PermissionSet>
       <classAccesses>
         <apexClass>CalloutService</apexClass>
         <enabled>true</enabled>
       </classAccesses>
     </PermissionSet>`,
    "utf-8"
  );
  return root;
}

test("A2: includeFlows adds flow nodes with edges to referenced Apex", () => {
  const root = makeFixtureRoot();
  try {
    const result = buildApexDependencyGraph({ rootDir: root, includeFlows: true });
    const flow = result.nodes.find((n) => n.kind === "flow");
    assert.ok(flow, "should include flow node");
    assert.equal(flow!.name, "OrderFlow");
    const edge = result.edges.find((e) => e.from === "OrderFlow" && e.to === "AccountService");
    assert.ok(edge, "expected edge OrderFlow -> AccountService");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("A2: includePermissionSets adds permission set nodes", () => {
  const root = makeFixtureRoot();
  try {
    const result = buildApexDependencyGraph({ rootDir: root, includePermissionSets: true });
    const ps = result.nodes.find((n) => n.kind === "permissionset");
    assert.ok(ps);
    assert.equal(ps!.name, "MyPS");
    assert.ok(result.edges.some((e) => e.from === "MyPS" && e.to === "CalloutService"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("A2: includeIntegrations detects HTTP and Named Credential refs", () => {
  const root = makeFixtureRoot();
  try {
    const result = buildApexDependencyGraph({ rootDir: root, includeIntegrations: true });
    const integrations = result.nodes.filter((n) => n.kind === "integration");
    assert.ok(integrations.some((n) => n.name === "ext:http"));
    assert.ok(integrations.some((n) => n.name === "ext:nc:MyEndpoint"));
    assert.ok(result.edges.some((e) => e.from === "CalloutService" && e.to === "ext:http"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("A2: defaults exclude all aux node kinds", () => {
  const root = makeFixtureRoot();
  try {
    const result = buildApexDependencyGraph({ rootDir: root });
    assert.equal(result.nodes.filter((n) => n.kind === "flow").length, 0);
    assert.equal(result.nodes.filter((n) => n.kind === "permissionset").length, 0);
    assert.equal(result.nodes.filter((n) => n.kind === "integration").length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
