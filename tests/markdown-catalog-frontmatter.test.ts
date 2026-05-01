import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { listMdFiles } from "../mcp/core/context/markdown-catalog.js";

test("Markdown catalog: agent frontmatter metadata is reflected in summary", () => {
  const root = mkdtempSync(join(tmpdir(), "catalog-frontmatter-"));
  const agentsDir = join(root, "agents");
  mkdirSync(agentsDir, { recursive: true });

  try {
    writeFileSync(
      join(agentsDir, "architect.md"),
      [
        "---",
        "name: architect",
        "capability: design-review",
        "triggerKeywords: [design, architecture]",
        "suggestedSkills: [apex, security]",
        "---",
        "# Architect",
        "System design specialist"
      ].join("\n"),
      "utf-8"
    );

    const result = listMdFiles(root, "agents");
    assert.equal(result.length, 1);
    assert.equal(result[0].name, "architect");
    assert.match(result[0].summary, /Architect/);
    assert.match(result[0].summary, /design-review/);
    assert.match(result[0].summary, /architecture/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Markdown catalog: frontmatter does not break non-agent directories", () => {
  const root = mkdtempSync(join(tmpdir(), "catalog-frontmatter-nonagent-"));
  const skillsDir = join(root, "skills");
  mkdirSync(skillsDir, { recursive: true });

  try {
    writeFileSync(
      join(skillsDir, "sample.md"),
      [
        "---",
        "name: sample",
        "---",
        "# Sample Skill",
        "sample summary"
      ].join("\n"),
      "utf-8"
    );

    const result = listMdFiles(root, "skills");
    assert.equal(result.length, 1);
    assert.equal(result[0].summary, "Sample Skill");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
