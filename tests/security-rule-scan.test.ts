import { test } from "node:test";
import { strict as assert } from "node:assert";
import { scanSecurityRules } from "../mcp/tools/security-rule-scan.js";

test("A9: detects SOQL injection via string concatenation", () => {
  const r = scanSecurityRules([
    { filePath: "Foo.cls", source: `String s = 'x'; List<Account> a = Database.query('SELECT Id FROM Account WHERE Name = ' + name);` }
  ]);
  const issue = r.issues.find((i) => i.rule === "soql-injection-concat");
  assert.ok(issue, "expected soql-injection-concat");
  assert.equal(issue!.severity, "high");
});

test("A9: detects hardcoded credentials", () => {
  const r = scanSecurityRules([
    { filePath: "config.ts", source: `const apiKey = "abcdef1234567890";` }
  ]);
  assert.ok(r.issues.find((i) => i.rule === "hardcoded-credential"));
});

test("A9: detects innerHTML XSS risk", () => {
  const r = scanSecurityRules([
    { filePath: "x.js", source: `el.innerHTML = userInput;` }
  ]);
  assert.ok(r.issues.find((i) => i.rule === "dom-innerhtml"));
});

test("A9: detects eval usage", () => {
  const r = scanSecurityRules([
    { filePath: "x.js", source: `eval("doSomething()");` }
  ]);
  assert.ok(r.issues.find((i) => i.rule === "eval-usage"));
});

test("A9: detects weak crypto algorithm", () => {
  const r = scanSecurityRules([
    { filePath: "Hash.cls", source: `Blob h = Crypto.generateDigest('MD5', input);` }
  ]);
  assert.ok(r.issues.find((i) => i.rule === "weak-crypto"));
});

test("A9: skips comment-only lines", () => {
  const r = scanSecurityRules([
    { filePath: "x.js", source: `// el.innerHTML = userInput;` }
  ]);
  assert.equal(r.totalIssues, 0);
});

test("A9: respects file extension filter (without-sharing only on .cls)", () => {
  const r = scanSecurityRules([
    { filePath: "x.js", source: `// without sharing in a JS comment` },
    { filePath: "Foo.cls", source: `public without sharing class Foo {}` }
  ]);
  const matches = r.issues.filter((i) => i.rule === "without-sharing");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].filePath, "Foo.cls");
});

test("A9: aggregates counts by severity", () => {
  const r = scanSecurityRules([
    { filePath: "Foo.cls", source: `public without sharing class Foo { Database.query('x'+y); }` },
    { filePath: "x.js", source: `el.innerHTML = userInput;` }
  ]);
  assert.ok(r.issuesBySeverity.high >= 2);
  assert.ok(r.issuesBySeverity.medium >= 1);
});
