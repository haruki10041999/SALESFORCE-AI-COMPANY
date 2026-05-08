import test from "node:test";
import assert from "node:assert/strict";

import {
  collectEnabledSystemPermissions,
  collectPermissionSetBlocks,
  getPermissionSetBooleanTag,
  getPermissionSetTagText
} from "../mcp/tools/permission-set-xml.js";

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<PermissionSet xmlns="http://soap.sforce.com/2006/04/metadata">
  <objectPermissions>
    <allowRead>true</allowRead>
    <allowCreate>false</allowCreate>
    <object>Account</object>
  </objectPermissions>
  <fieldPermissions>
    <editable>true</editable>
    <field>Account.Name</field>
    <readable>true</readable>
  </fieldPermissions>
  <permissionsViewAllData>true</permissionsViewAllData>
  <permissionsModifyAllData>false</permissionsModifyAllData>
</PermissionSet>`;

test("permission set xml helpers extract blocks and booleans", () => {
  const objectBlocks = collectPermissionSetBlocks(XML, "objectPermissions");
  assert.equal(objectBlocks.length, 1);
  assert.equal(getPermissionSetTagText(objectBlocks[0] ?? "", "object"), "Account");
  assert.equal(getPermissionSetBooleanTag(objectBlocks[0] ?? "", "allowRead"), true);
  assert.equal(getPermissionSetBooleanTag(objectBlocks[0] ?? "", "allowCreate"), false);
});

test("permission set xml helpers collect enabled system permissions", () => {
  const permissions = collectEnabledSystemPermissions(XML);
  assert.equal(permissions.has("ViewAllData"), true);
  assert.equal(permissions.has("ModifyAllData"), false);
});
