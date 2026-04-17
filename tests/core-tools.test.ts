import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeRepo } from "../mcp/tools/repo-analyzer.js";
import { analyzeApex } from "../mcp/tools/apex-analyzer.js";
import { analyzeLwc } from "../mcp/tools/lwc-analyzer.js";
import { buildDeployCommand } from "../mcp/tools/deploy-org.js";
import { buildTestCommand } from "../mcp/tools/run-tests.js";

function createTempRoot(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "sf-ai-company-core-tools-"));
  return {
    root,
    cleanup: () => rmSync(root, { recursive: true, force: true })
  };
}

test("analyzeRepo detects apex, lwc, and object metadata files", () => {
  const fixture = createTempRoot();
  try {
    const clsFile = join(fixture.root, "force-app", "main", "default", "classes", "AccountService.cls");
    const lwcFile = join(fixture.root, "force-app", "main", "default", "lwc", "helloWorld", "helloWorld.js");
    const objectFile = join(fixture.root, "force-app", "main", "default", "objects", "Account", "Account.object-meta.xml");

    mkdirSync(join(clsFile, ".."), { recursive: true });
    mkdirSync(join(lwcFile, ".."), { recursive: true });
    mkdirSync(join(objectFile, ".."), { recursive: true });

    writeFileSync(clsFile, "public with sharing class AccountService {}\n", "utf-8");
    writeFileSync(lwcFile, "export default class HelloWorld {}\n", "utf-8");
    writeFileSync(objectFile, "<CustomObject></CustomObject>\n", "utf-8");

    const result = analyzeRepo(fixture.root);

    assert.equal(result.apex.length, 1);
    assert.equal(result.lwc.length, 1);
    assert.equal(result.objects.length, 1);
    assert.ok(result.apex[0].endsWith("AccountService.cls"));
    assert.ok(result.lwc[0].endsWith("helloWorld.js"));
    assert.ok(result.objects[0].endsWith("Account.object-meta.xml"));
  } finally {
    fixture.cleanup();
  }
});

test("analyzeApex detects trigger-pattern hint and SOQL-in-loop risk", () => {
  const fixture = createTempRoot();
  try {
    const filePath = join(fixture.root, "Risky.cls");
    writeFileSync(
      filePath,
      [
        "trigger AccountTrigger on Account (before insert) {",
        "  for (Account a : Trigger.new) {",
        "    List<Contact> c = [SELECT Id FROM Contact WHERE AccountId = :a.Id];",
        "  }",
        "}"
      ].join("\n"),
      "utf-8"
    );

    const result = analyzeApex(filePath);
    assert.equal(result.hasTriggerPatternHints, true);
    assert.equal(result.hasSoqlInLoopRisk, true);
  } finally {
    fixture.cleanup();
  }
});

test("analyzeLwc detects @wire and @api decorators", () => {
  const fixture = createTempRoot();
  try {
    const filePath = join(fixture.root, "sample.js");
    writeFileSync(
      filePath,
      [
        "import { LightningElement, api, wire } from 'lwc';",
        "export default class Sample extends LightningElement {",
        "  @api recordId;",
        "  @wire(getRecord, { recordId: '$recordId' }) record;",
        "}"
      ].join("\n"),
      "utf-8"
    );

    const result = analyzeLwc(filePath);
    assert.equal(result.usesWire, true);
    assert.equal(result.hasApiDecorator, true);
  } finally {
    fixture.cleanup();
  }
});

test("buildDeployCommand returns check-only command by default", () => {
  const result = buildDeployCommand("myOrg");
  assert.equal(result.dryRun, true);
  assert.ok(result.command.includes("--check-only"));
  assert.ok(result.command.includes("--target-org myOrg"));
});

test("buildDeployCommand without dry-run omits check-only", () => {
  const result = buildDeployCommand("myOrg", false);
  assert.equal(result.dryRun, false);
  assert.equal(result.command.includes("--check-only"), false);
});

test("buildTestCommand includes target org and code coverage flags", () => {
  const command = buildTestCommand("mySandbox");
  assert.ok(command.includes("--target-org mySandbox"));
  assert.ok(command.includes("--code-coverage"));
  assert.ok(command.includes("--wait 30"));
});
