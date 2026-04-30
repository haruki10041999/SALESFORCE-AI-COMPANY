import test from "node:test";
import assert from "node:assert/strict";
import { simulateDependencyImpact } from "../mcp/core/dependency/impact-simulator.js";

test("simulateDependencyImpact aggregates risk/domain metrics", () => {
  const result = simulateDependencyImpact({
    comparison: "main...feature/demo",
    summary: "dummy",
    targets: [
      {
        kind: "CustomField",
        status: "D",
        sourcePath: "force-app/main/default/objects/Account/fields/Legacy__c.field-meta.xml",
        apiName: "Account.Legacy__c",
        objectApiName: "Account",
        references: [
          { filePath: "force-app/main/default/classes/AccountService.cls", line: 12, snippet: "Account.Legacy__c" },
          { filePath: "force-app/main/default/flows/Account.flow-meta.xml", line: 4, snippet: "Legacy__c" }
        ],
        risk: "high"
      },
      {
        kind: "CustomObject",
        status: "M",
        sourcePath: "force-app/main/default/objects/Invoice/Invoice.object-meta.xml",
        apiName: "Invoice",
        objectApiName: "Invoice",
        references: [
          { filePath: "force-app/main/default/permissionsets/Admin.permissionset-meta.xml", line: 8, snippet: "Invoice" }
        ],
        risk: "medium"
      }
    ]
  });

  assert.equal(result.comparison, "main...feature/demo");
  assert.equal(result.summary.totalTargets, 2);
  assert.equal(result.summary.riskCounts.high, 1);
  assert.equal(result.summary.riskCounts.medium, 1);
  assert.ok(result.summary.totalImpactScore > 0);
  assert.ok(result.summary.domainCounts.apex >= 1);
  assert.ok(result.summary.domainCounts.flow >= 1);
  assert.ok(result.summary.domainCounts.permission >= 1);
  assert.ok(result.recommendations.length >= 1);
});

test("simulateDependencyImpact returns fallback recommendation for low impact", () => {
  const result = simulateDependencyImpact({
    comparison: "main...feature/low",
    summary: "dummy",
    targets: [
      {
        kind: "CustomField",
        status: "A",
        sourcePath: "force-app/main/default/objects/Contact/fields/New__c.field-meta.xml",
        apiName: "Contact.New__c",
        objectApiName: "Contact",
        references: [],
        risk: "low"
      }
    ]
  });

  assert.equal(result.summary.riskCounts.low, 1);
  assert.ok(result.recommendations.some((item) => item.includes("No major impact signal")));
});
