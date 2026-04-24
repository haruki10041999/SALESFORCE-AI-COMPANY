import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { compareOrgMetadata } from "../mcp/tools/org-metadata-diff.js";

test("compareOrgMetadata compares baseline against multiple org inventories", () => {
  const root = mkdtempSync(join(tmpdir(), "sf-ai-org-diff-test-"));
  try {
    const baselineFile = join(root, "baseline.json");
    const stagingFile = join(root, "staging.json");
    const devFile = join(root, "dev.json");

    writeFileSync(
      baselineFile,
      JSON.stringify(
        {
          components: [
            { type: "ApexClass", name: "OrderService" },
            { type: "ApexClass", name: "BillingService" },
            { type: "Flow", name: "OrderFlow" }
          ]
        },
        null,
        2
      ),
      "utf-8"
    );

    writeFileSync(
      stagingFile,
      JSON.stringify(
        [
          { type: "ApexClass", name: "OrderService" },
          { type: "ApexClass", name: "BillingService" },
          { type: "Flow", name: "OrderFlowV2" }
        ],
        null,
        2
      ),
      "utf-8"
    );

    writeFileSync(
      devFile,
      JSON.stringify(
        [
          "ApexClass:OrderService",
          "Flow:OrderFlow",
          "Flow:OrderFlowPreview"
        ],
        null,
        2
      ),
      "utf-8"
    );

    const result = compareOrgMetadata({
      baselineOrg: "prod",
      baselineInventoryFile: baselineFile,
      compareOrgs: [
        { org: "staging", inventoryFile: stagingFile },
        { org: "dev", inventoryFile: devFile }
      ],
      sampleLimit: 3
    });

    assert.equal(result.baseline.org, "prod");
    assert.equal(result.baseline.totalComponents, 3);

    const staging = result.comparisons.find((item) => item.org === "staging");
    const dev = result.comparisons.find((item) => item.org === "dev");
    assert.ok(staging);
    assert.ok(dev);

    assert.equal(staging!.commonCount, 2);
    assert.equal(staging!.addedCount, 1);
    assert.equal(staging!.missingCount, 1);

    assert.equal(dev!.commonCount, 2);
    assert.equal(dev!.addedCount, 1);
    assert.equal(dev!.missingCount, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
