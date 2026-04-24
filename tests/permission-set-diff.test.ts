import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { diffPermissionSet } from "../mcp/tools/permission-set-diff.js";

const BASELINE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<PermissionSet xmlns="http://soap.sforce.com/2006/04/metadata">
  <objectPermissions>
    <allowCreate>true</allowCreate>
    <allowDelete>false</allowDelete>
    <allowEdit>true</allowEdit>
    <allowRead>true</allowRead>
    <modifyAllRecords>false</modifyAllRecords>
    <object>Account</object>
    <viewAllRecords>false</viewAllRecords>
  </objectPermissions>
  <fieldPermissions>
    <editable>true</editable>
    <field>Account.Name</field>
    <readable>true</readable>
  </fieldPermissions>
  <permissionsViewAllData>true</permissionsViewAllData>
</PermissionSet>`;

const TARGET_XML = `<?xml version="1.0" encoding="UTF-8"?>
<PermissionSet xmlns="http://soap.sforce.com/2006/04/metadata">
  <objectPermissions>
    <allowCreate>true</allowCreate>
    <allowDelete>false</allowDelete>
    <allowEdit>false</allowEdit>
    <allowRead>true</allowRead>
    <modifyAllRecords>false</modifyAllRecords>
    <object>Account</object>
    <viewAllRecords>false</viewAllRecords>
  </objectPermissions>
  <fieldPermissions>
    <editable>true</editable>
    <field>Account.Secret__c</field>
    <readable>true</readable>
  </fieldPermissions>
  <permissionsModifyAllData>true</permissionsModifyAllData>
</PermissionSet>`;

test("diffPermissionSet detects missing and excessive permissions", () => {
  const root = mkdtempSync(join(tmpdir(), "sf-ai-perm-diff-test-"));
  const baseline = join(root, "baseline.permissionset-meta.xml");
  const target = join(root, "target.permissionset-meta.xml");

  try {
    writeFileSync(baseline, BASELINE_XML, "utf-8");
    writeFileSync(target, TARGET_XML, "utf-8");

    const result = diffPermissionSet({
      baselineFilePath: baseline,
      targetFilePath: target,
      sampleLimit: 20
    });

    assert.ok(result.summary.missingCount > 0);
    assert.ok(result.summary.excessiveCount > 0);
    assert.ok(result.missingInTarget.objectPermissions.some((item) => item.includes("Account")));
    assert.ok(result.missingInTarget.fieldPermissions.some((item) => item.includes("Account.Name")));
    assert.ok(result.missingInTarget.systemPermissions.includes("ViewAllData"));
    assert.ok(result.excessiveInTarget.fieldPermissions.some((item) => item.includes("Account.Secret__c")));
    assert.ok(result.excessiveInTarget.systemPermissions.includes("ModifyAllData"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
