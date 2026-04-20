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
        "// TriggerHandler for Account",
        "public with sharing class AccountHandler {",
        "  public void handleInsert(List<Account> newList) {",
        "    for (Account a : newList) {",
        "      List<Contact> c = [SELECT Id FROM Contact WHERE AccountId = :a.Id];",
        "    }",
        "  }",
        "}"
      ].join("\n"),
      "utf-8"
    );

    const result = analyzeApex(filePath);
    assert.equal(result.hasTriggerPatternHints, true);  // "handler" キーワードにマッチ
    assert.equal(result.hasSoqlInLoopRisk, true);
    // 新規項目: DML なし
    assert.equal(result.hasDmlInLoopRisk, false);
    assert.equal(result.withoutSharingUsed, false);
    assert.equal(result.dynamicSoqlUsed, false);
    assert.equal(result.testClassDetected, false);
    assert.equal(result.hasAsyncMethod, false);
  } finally {
    fixture.cleanup();
  }
});

test("analyzeApex detects DML-in-loop, without sharing, dynamic SOQL, and missing CRUD guard", () => {
  const fixture = createTempRoot();
  try {
    const filePath = join(fixture.root, "Risky2.cls");
    writeFileSync(
      filePath,
      [
        "public without sharing class OrderService {",
        "  public static void sync(List<Account> items) {",
        "    for (Account a : items) {",
        "      List<Contact> rows = Database.query('SELECT Id FROM Contact WHERE AccountId = :a.Id');",
        "      update rows;",
        "    }",
        "  }",
        "}"
      ].join("\n"),
      "utf-8"
    );

    const result = analyzeApex(filePath);
    assert.equal(result.hasDmlInLoopRisk, true);
    assert.equal(result.withoutSharingUsed, true);
    assert.equal(result.dynamicSoqlUsed, true);
    assert.equal(result.missingCrudFlsCheck, true); // update あり、CRUD guard なし
  } finally {
    fixture.cleanup();
  }
});

test("analyzeApex detects @IsTest and @future annotations", () => {
  const fixture = createTempRoot();
  try {
    const filePath = join(fixture.root, "TestClass.cls");
    writeFileSync(
      filePath,
      [
        "@IsTest",
        "private class OrderServiceTest {",
        "  @future",
        "  public static void runAsync() {}",
        "}"
      ].join("\n"),
      "utf-8"
    );

    const result = analyzeApex(filePath);
    assert.equal(result.testClassDetected, true);
    assert.equal(result.hasAsyncMethod, true);
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
    // 新規項目
    assert.equal(result.hasImperativeApex, false); // @wire使用あり
    assert.equal(result.usesNavigationMixin, false);
    assert.equal(result.usesCustomLabels, false);
    assert.equal(result.hasEventDispatch, false);
  } finally {
    fixture.cleanup();
  }
});

test("analyzeLwc detects NavigationMixin and dispatchEvent", () => {
  const fixture = createTempRoot();
  try {
    const filePath = join(fixture.root, "navComponent.js");
    writeFileSync(
      filePath,
      [
        "import { LightningElement } from 'lwc';",
        "import { NavigationMixin } from 'lightning/navigation';",
        "export default class NavComponent extends NavigationMixin(LightningElement) {",
        "  navigate() { this[NavigationMixin.Navigate]({ type: 'standard__home' }); }",
        "  fire() { this.dispatchEvent(new CustomEvent('myevent')); }",
        "}"
      ].join("\n"),
      "utf-8"
    );

    const result = analyzeLwc(filePath);
    assert.equal(result.usesNavigationMixin, true);
    assert.equal(result.hasEventDispatch, true);
  } finally {
    fixture.cleanup();
  }
});

test("buildDeployCommand returns check-only command by default", () => {
  const result = buildDeployCommand("myOrg");
  assert.equal(result.dryRun, true);
  assert.ok(result.command.includes("--check-only"));
  assert.ok(result.command.includes("--target-org myOrg"));
  assert.ok(result.command.includes("--source-dir force-app"));
  assert.ok(result.command.includes("--test-level RunLocalTests"));
});

test("buildDeployCommand without dry-run omits check-only", () => {
  const result = buildDeployCommand("myOrg", false);
  assert.equal(result.dryRun, false);
  assert.equal(result.command.includes("--check-only"), false);
});

test("buildDeployCommand accepts DeployInput object with custom options", () => {
  const result = buildDeployCommand({
    targetOrg: "staging",
    dryRun: false,
    sourceDir: "custom-app",
    testLevel: "RunSpecifiedTests",
    specificTests: ["AccountTest", "ContactTest"],
    wait: 60,
    ignoreWarnings: true
  });
  assert.equal(result.dryRun, false);
  assert.ok(result.command.includes("--source-dir custom-app"));
  assert.ok(result.command.includes("--test-level RunSpecifiedTests"));
  assert.ok(result.command.includes("--tests AccountTest,ContactTest"));
  assert.ok(result.command.includes("--wait 60"));
  assert.ok(result.command.includes("--ignore-warnings"));
});

test("buildTestCommand includes target org and code coverage flags", () => {
  const command = buildTestCommand("mySandbox");
  assert.ok(command.includes("--target-org mySandbox"));
  assert.ok(command.includes("--code-coverage"));
  assert.ok(command.includes("--wait 30"));
});

test("buildTestCommand accepts RunTestsInput object with classNames and suiteName", () => {
  const command = buildTestCommand({
    targetOrg: "staging",
    classNames: ["OrderTest", "ContactTest"],
    suiteName: "SmokeSuite",
    wait: 45,
    outputDir: "coverage-output"
  });
  assert.ok(command.includes("--target-org staging"));
  assert.ok(command.includes("--class-names OrderTest,ContactTest"));
  assert.ok(command.includes("--suite-names SmokeSuite"));
  assert.ok(command.includes("--wait 45"));
  assert.ok(command.includes("--output-dir coverage-output"));
});
