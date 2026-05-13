import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateComplianceReport } from "../scripts/dr/generate-compliance-report.js";

test("generateComplianceReport produces SOC2 report artifacts", async () => {
  const root = await mkdtemp(join(tmpdir(), "sfai-compliance-"));
  const outputsDir = join(root, "outputs");
  const reportsDir = join(outputsDir, "reports");
  const docsDir = join(root, "docs", "compliance");

  try {
    await mkdir(reportsDir, { recursive: true });
    await mkdir(docsDir, { recursive: true });

    await writeFile(
      join(reportsDir, "backup-verify-latest.json"),
      JSON.stringify({ ok: true, availableSnapshots: 3, issues: [] }),
      "utf-8"
    );
    await writeFile(
      join(reportsDir, "dr-restore-latest.json"),
      JSON.stringify({ snapshot: "s-1", dryRun: true, restoredEntries: ["events/system-events.jsonl"] }),
      "utf-8"
    );
    await writeFile(
      join(reportsDir, "siem-export-latest.json"),
      JSON.stringify({
        provider: "ndjson",
        target: join(outputsDir, "audit", "siem-export.jsonl"),
        exportedCount: 10,
        metrics: { batchesFailed: 0, retryCount: 1, httpRequestCount: 2 }
      }),
      "utf-8"
    );

    const reportPath = join(reportsDir, "compliance-soc2-latest.json");
    const markdownPath = join(docsDir, "soc2-dr-siem-latest.md");
    const report = await generateComplianceReport({ outputsDir, reportPath, markdownPath });

    assert.equal(report.framework, "SOC2");
    assert.equal(report.overallStatus, "pass");
    assert.equal(report.controls.length, 3);
    assert.ok(report.iso27001Summary.includes("A.12.4.1"));
    assert.ok(report.controls.every((control) => control.iso27001Mappings.length > 0));

    const jsonPersisted = JSON.parse(await readFile(reportPath, "utf-8")) as {
      framework: string;
      controls: unknown[];
      iso27001Summary: string[];
    };
    assert.equal(jsonPersisted.framework, "SOC2");
    assert.equal(Array.isArray(jsonPersisted.controls), true);
    assert.ok(jsonPersisted.iso27001Summary.includes("A.17.1.2"));

    const markdownPersisted = await readFile(markdownPath, "utf-8");
    assert.ok(markdownPersisted.includes("SOC2 Compliance Report"));
    assert.ok(markdownPersisted.includes("CC7.2"));
    assert.ok(markdownPersisted.includes("ISO27001"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
