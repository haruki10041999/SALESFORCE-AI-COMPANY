import { test } from "node:test";
import { strict as assert } from "node:assert";

import { scanTextForSensitiveData, type SensitiveDataFinding } from "../scripts/precommit-guard.js";

test("precommit guard detects hardcoded credential assignment", () => {
  const findings = scanTextForSensitiveData(`{"BACKLOG_API_KEY":"replace_me_12345"}`, "config.json");
  assert.equal(findings.length > 0, true);
  assert.equal(findings.some((item: SensitiveDataFinding) => item.label.includes("API_KEY") || item.label.includes("assignment")), true);
});

test("precommit guard ignores placeholder sample values", () => {
  const findings = scanTextForSensitiveData("BACKLOG_API_KEY=changeme", ".env.sample");
  assert.equal(findings.length, 0);
});

test("precommit guard detects raw email in config-like files", () => {
  const findings = scanTextForSensitiveData('{"owner":"haruki@example.com"}', "outputs/sample.json");
  assert.equal(findings.some((item: SensitiveDataFinding) => item.label === "email address"), true);
});
