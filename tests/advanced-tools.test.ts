import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { suggestChangedTests } from "../mcp/tools/changed-tests-suggest.js";
import { summarizeDeploymentImpact } from "../mcp/tools/deployment-impact-summary.js";
import { checkPrReadiness } from "../mcp/tools/pr-readiness-check.js";
import { scanSecurityDelta } from "../mcp/tools/security-delta-scan.js";
import { estimateChangedCoverage } from "../mcp/tools/coverage-estimate.js";
import { buildMetadataDependencyGraph } from "../mcp/tools/metadata-dependency-graph.js";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
}

function writeText(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf-8");
}

function setupRepoForAdvancedTools(): {
  repoPath: string;
  baseBranch: string;
  workingBranch: string;
  cleanup: () => void;
} {
  const repoPath = mkdtempSync(join(tmpdir(), "sf-ai-company-advanced-test-"));

  git(repoPath, ["init"]);
  git(repoPath, ["config", "user.email", "test@example.com"]);
  git(repoPath, ["config", "user.name", "test-user"]);
  git(repoPath, ["checkout", "-b", "main"]);

  writeText(join(repoPath, "README.md"), "# advanced test repo\n");
  writeText(
    join(repoPath, "force-app", "main", "default", "classes", "OrderService.cls"),
    "public with sharing class OrderService {\n  public static void sync() {}\n}\n"
  );
  writeText(
    join(repoPath, "force-app", "main", "default", "lwc", "orderPanel", "orderPanel.js"),
    "export default class OrderPanel {}\n"
  );
  writeText(
    join(repoPath, "force-app", "main", "default", "permissionsets", "Base.permissionset-meta.xml"),
    "<PermissionSet></PermissionSet>\n"
  );
  git(repoPath, ["add", "."]);
  git(repoPath, ["commit", "-m", "initial"]);

  const workingBranch = "feature/security-and-impact";
  git(repoPath, ["checkout", "-b", workingBranch]);

  writeText(
    join(repoPath, "force-app", "main", "default", "classes", "OrderService.cls"),
    [
      "public without sharing class OrderService {",
      "  public static void sync(List<Account> items) {",
      "    for (Account a : items) {",
      "      List<Contact> rows = Database.query('SELECT Id FROM Contact WHERE AccountId = :a.Id');",
      "      update rows;",
      "    }",
      "  }",
      "}"
    ].join("\n")
  );

  writeText(
    join(repoPath, "force-app", "main", "default", "lwc", "orderPanel", "orderPanel.js"),
    "export default class OrderPanel { render(){ return true; } }\n"
  );

  writeText(
    join(repoPath, "force-app", "main", "default", "permissionsets", "Base.permissionset-meta.xml"),
    "<PermissionSet><fieldPermissions></fieldPermissions></PermissionSet>\n"
  );

  writeText(
    join(repoPath, "force-app", "main", "default", "flows", "OrderFlow.flow-meta.xml"),
    "<Flow></Flow>\n"
  );

  writeText(
    join(repoPath, "force-app", "main", "default", "classes", "OrderServiceTest.cls"),
    "@IsTest private class OrderServiceTest { @IsTest static void testSync() {} }\n"
  );

  git(repoPath, ["add", "."]);
  git(repoPath, ["commit", "-m", "feature updates"]);

  return {
    repoPath,
    baseBranch: "main",
    workingBranch,
    cleanup: () => rmSync(repoPath, { recursive: true, force: true })
  };
}

function setupRepoWithDeletionAndNoTests(): {
  repoPath: string;
  baseBranch: string;
  workingBranch: string;
  cleanup: () => void;
} {
  const repoPath = mkdtempSync(join(tmpdir(), "sf-ai-company-advanced-edge-"));

  git(repoPath, ["init"]);
  git(repoPath, ["config", "user.email", "test@example.com"]);
  git(repoPath, ["config", "user.name", "test-user"]);
  git(repoPath, ["checkout", "-b", "main"]);

  writeText(
    join(repoPath, "force-app", "main", "default", "classes", "LegacyService.cls"),
    "public with sharing class LegacyService { public static void oldMethod() {} }\n"
  );
  writeText(
    join(repoPath, "force-app", "main", "default", "classes", "ActiveService.cls"),
    "public with sharing class ActiveService { public static void run() {} }\n"
  );

  git(repoPath, ["add", "."]);
  git(repoPath, ["commit", "-m", "base commit"]);

  const workingBranch = "feature/no-tests-with-delete";
  git(repoPath, ["checkout", "-b", workingBranch]);

  git(repoPath, ["rm", "force-app/main/default/classes/LegacyService.cls"]);
  writeText(
    join(repoPath, "force-app", "main", "default", "classes", "ActiveService.cls"),
    "public with sharing class ActiveService { public static void run(){ List<Account> rows = [SELECT Id FROM Account]; update rows; } }\n"
  );

  git(repoPath, ["add", "."]);
  git(repoPath, ["commit", "-m", "delete legacy and update active"]);

  return {
    repoPath,
    baseBranch: "main",
    workingBranch,
    cleanup: () => rmSync(repoPath, { recursive: true, force: true })
  };
}

function setupRepoForSecurityFalsePositive(): {
  repoPath: string;
  baseBranch: string;
  workingBranch: string;
  cleanup: () => void;
} {
  const repoPath = mkdtempSync(join(tmpdir(), "sf-ai-company-advanced-security-fp-"));

  git(repoPath, ["init"]);
  git(repoPath, ["config", "user.email", "test@example.com"]);
  git(repoPath, ["config", "user.name", "test-user"]);
  git(repoPath, ["checkout", "-b", "main"]);

  writeText(
    join(repoPath, "force-app", "main", "default", "classes", "CommentOnly.cls"),
    [
      "public with sharing class CommentOnly {",
      "  public static void run() {}",
      "}"
    ].join("\n")
  );

  git(repoPath, ["add", "."]);
  git(repoPath, ["commit", "-m", "base"]);

  const workingBranch = "feature/security-comment-only";
  git(repoPath, ["checkout", "-b", workingBranch]);

  writeText(
    join(repoPath, "force-app", "main", "default", "classes", "CommentOnly.cls"),
    [
      "public with sharing class CommentOnly {",
      "  public static void run() {",
      "    // without sharing should not be detected from comments",
      "    // Database.query('SELECT Id FROM Account') should also be ignored",
      "    String note = 'update rows';",
      "  }",
      "}"
    ].join("\n")
  );

  git(repoPath, ["add", "."]);
  git(repoPath, ["commit", "-m", "comment only additions"]);

  return {
    repoPath,
    baseBranch: "main",
    workingBranch,
    cleanup: () => rmSync(repoPath, { recursive: true, force: true })
  };
}

function setupRepoForMetadataDependency(): {
  repoPath: string;
  baseBranch: string;
  workingBranch: string;
  cleanup: () => void;
} {
  const repoPath = mkdtempSync(join(tmpdir(), "sf-ai-company-metadata-deps-"));

  git(repoPath, ["init"]);
  git(repoPath, ["config", "user.email", "test@example.com"]);
  git(repoPath, ["config", "user.name", "test-user"]);
  git(repoPath, ["checkout", "-b", "main"]);

  writeText(
    join(repoPath, "force-app", "main", "default", "objects", "Invoice__c", "Invoice__c.object-meta.xml"),
    "<CustomObject></CustomObject>\n"
  );
  writeText(
    join(repoPath, "force-app", "main", "default", "objects", "Invoice__c", "fields", "LegacyCode__c.field-meta.xml"),
    "<CustomField></CustomField>\n"
  );
  writeText(
    join(repoPath, "force-app", "main", "default", "classes", "InvoiceService.cls"),
    [
      "public with sharing class InvoiceService {",
      "  public static List<Invoice__c> find(){",
      "    return [SELECT Id, LegacyCode__c FROM Invoice__c];",
      "  }",
      "}"
    ].join("\n")
  );

  git(repoPath, ["add", "."]);
  git(repoPath, ["commit", "-m", "base metadata"]);

  const workingBranch = "feature/remove-legacy-field";
  git(repoPath, ["checkout", "-b", workingBranch]);

  git(repoPath, ["rm", "force-app/main/default/objects/Invoice__c/fields/LegacyCode__c.field-meta.xml"]);
  writeText(
    join(repoPath, "force-app", "main", "default", "classes", "InvoiceController.cls"),
    "public with sharing class InvoiceController { public static String f = 'LegacyCode__c'; }\n"
  );

  git(repoPath, ["add", "."]);
  git(repoPath, ["commit", "-m", "remove field metadata but keep references"]);

  return {
    repoPath,
    baseBranch: "main",
    workingBranch,
    cleanup: () => rmSync(repoPath, { recursive: true, force: true })
  };
}

test("suggestChangedTests returns Apex and LWC related candidates", () => {
  const fixture = setupRepoForAdvancedTools();
  try {
    const result = suggestChangedTests({
      repoPath: fixture.repoPath,
      integrationBranch: fixture.baseBranch,
      workingBranch: fixture.workingBranch,
      targetOrg: "devOrg"
    });

    assert.equal(result.comparison, "main...feature/security-and-impact");
    assert.ok(result.changedSourceFiles.some((p) => p.endsWith("OrderService.cls")));
    assert.ok(result.suggestions.some((s) => s.testName === "OrderServiceTest"));
    assert.ok(result.runCommand?.includes("--target-org devOrg"));
    assert.ok(result.summary.includes("候補テスト数"));
  } finally {
    fixture.cleanup();
  }
});

test("summarizeDeploymentImpact aggregates metadata changes and cautions", () => {
  const fixture = setupRepoForAdvancedTools();
  try {
    const result = summarizeDeploymentImpact({
      repoPath: fixture.repoPath,
      integrationBranch: fixture.baseBranch,
      workingBranch: fixture.workingBranch
    });

    assert.equal(result.comparison, "main...feature/security-and-impact");
    assert.ok((result.metadataBreakdown.ApexClass ?? 0) >= 1);
    assert.ok((result.metadataBreakdown.PermissionSet ?? 0) >= 1);
    assert.ok((result.metadataBreakdown.Flow ?? 0) >= 1);
    assert.ok(result.cautions.some((c) => c.includes("権限関連メタデータ")));
    assert.ok(result.cautions.some((c) => c.includes("Flow変更")));
  } finally {
    fixture.cleanup();
  }
});

test("checkPrReadiness computes score and recommends relevant agents", () => {
  const fixture = setupRepoForAdvancedTools();
  try {
    const result = checkPrReadiness({
      repoPath: fixture.repoPath,
      integrationBranch: fixture.baseBranch,
      workingBranch: fixture.workingBranch
    });

    assert.equal(result.comparison, "main...feature/security-and-impact");
    assert.ok(result.changedFiles >= 4);
    assert.ok(result.checklist.length >= 4);
    assert.ok(result.recommendedAgents.includes("apex-developer"));
    assert.ok(result.recommendedAgents.includes("lwc-developer"));
    assert.ok(result.recommendedAgents.includes("security-engineer"));
    assert.ok(["ready", "needs-review", "blocked"].includes(result.gate));
  } finally {
    fixture.cleanup();
  }
});

test("checkPrReadiness accepts baseBranch without integrationBranch", () => {
  const fixture = setupRepoForAdvancedTools();
  try {
    const result = checkPrReadiness({
      repoPath: fixture.repoPath,
      baseBranch: fixture.baseBranch,
      workingBranch: fixture.workingBranch
    });

    assert.equal(result.comparison, "main...feature/security-and-impact");
  } finally {
    fixture.cleanup();
  }
});

test("checkPrReadiness applies multilingual needs-review keywords", () => {
  const fixture = setupRepoForAdvancedTools();
  try {
    const result = checkPrReadiness({
      repoPath: fixture.repoPath,
      integrationBranch: fixture.baseBranch,
      workingBranch: fixture.workingBranch,
      reviewText: "要修正: edge case handling is missing"
    });

    assert.equal(result.reviewSignal?.decision, "blocked");
    assert.equal(result.gate, "blocked");
    assert.ok(result.summary.includes("レビュー判定"));
  } finally {
    fixture.cleanup();
  }
});

test("checkPrReadiness recognizes multilingual approval keywords", () => {
  const fixture = setupRepoForAdvancedTools();
  try {
    const result = checkPrReadiness({
      repoPath: fixture.repoPath,
      integrationBranch: fixture.baseBranch,
      workingBranch: fixture.workingBranch,
      reviewText: "LGTM 承認 approved"
    });

    assert.equal(result.reviewSignal?.decision, "ready");
    assert.ok(result.summary.includes("最終ゲート"));
  } finally {
    fixture.cleanup();
  }
});

test("scanSecurityDelta detects high and medium findings from added lines", () => {
  const fixture = setupRepoForAdvancedTools();
  try {
    const result = scanSecurityDelta({
      repoPath: fixture.repoPath,
      integrationBranch: fixture.baseBranch,
      workingBranch: fixture.workingBranch,
      maxFindings: 20
    });

    assert.equal(result.comparison, "main...feature/security-and-impact");
    assert.ok(result.findings.some((f) => f.rule === "sharing-rule"));
    assert.ok(result.findings.some((f) => f.rule === "dynamic-soql"));
    assert.ok(result.findings.some((f) => f.rule === "crud-fls-check"));
    assert.ok(result.summary.includes("検出件数"));
  } finally {
    fixture.cleanup();
  }
});

test("suggestChangedTests throws for invalid branch names", () => {
  const fixture = setupRepoForAdvancedTools();
  try {
    assert.throws(
      () => suggestChangedTests({
        repoPath: fixture.repoPath,
        integrationBranch: "-main",
        workingBranch: fixture.workingBranch
      }),
      /Invalid (baseBranch|integrationBranch)/
    );
  } finally {
    fixture.cleanup();
  }
});

test("suggestChangedTests throws for invalid targetOrg", () => {
  const fixture = setupRepoForAdvancedTools();
  try {
    assert.throws(
      () => suggestChangedTests({
        repoPath: fixture.repoPath,
        baseBranch: fixture.baseBranch,
        workingBranch: fixture.workingBranch,
        targetOrg: "devOrg;whoami"
      }),
      /targetOrg validation failed/
    );
  } finally {
    fixture.cleanup();
  }
});

test("summarizeDeploymentImpact includes deletion caution when files are removed", () => {
  const fixture = setupRepoWithDeletionAndNoTests();
  try {
    const result = summarizeDeploymentImpact({
      repoPath: fixture.repoPath,
      integrationBranch: fixture.baseBranch,
      workingBranch: fixture.workingBranch
    });

    assert.ok(result.deletions >= 1);
    assert.ok(result.cautions.some((c) => c.includes("削除差分")));
  } finally {
    fixture.cleanup();
  }
});

test("checkPrReadiness warns when no test files changed", () => {
  const fixture = setupRepoWithDeletionAndNoTests();
  try {
    const result = checkPrReadiness({
      repoPath: fixture.repoPath,
      integrationBranch: fixture.baseBranch,
      workingBranch: fixture.workingBranch
    });

    const testItem = result.checklist.find((item) => item.id === "tests");
    assert.ok(testItem);
    assert.equal(testItem?.status, "warning");
  } finally {
    fixture.cleanup();
  }
});

test("scanSecurityDelta respects maxFindings limit", () => {
  const fixture = setupRepoForAdvancedTools();
  try {
    const result = scanSecurityDelta({
      repoPath: fixture.repoPath,
      integrationBranch: fixture.baseBranch,
      workingBranch: fixture.workingBranch,
      maxFindings: 1
    });

    assert.equal(result.findings.length, 1);
  } finally {
    fixture.cleanup();
  }
});

test("scanSecurityDelta ignores comment and string literal noise", () => {
  const fixture = setupRepoForSecurityFalsePositive();
  try {
    const result = scanSecurityDelta({
      repoPath: fixture.repoPath,
      integrationBranch: fixture.baseBranch,
      workingBranch: fixture.workingBranch,
      maxFindings: 20
    });

    assert.equal(result.findings.length, 0);
  } finally {
    fixture.cleanup();
  }
});

test("suggestChangedTests accepts baseBranch without integrationBranch", () => {
  const fixture = setupRepoForAdvancedTools();
  try {
    const result = suggestChangedTests({
      repoPath: fixture.repoPath,
      baseBranch: fixture.baseBranch,
      workingBranch: fixture.workingBranch
    });

    assert.equal(result.comparison, "main...feature/security-and-impact");
  } finally {
    fixture.cleanup();
  }
});

test("estimateChangedCoverage maps changed classes to likely tests", () => {
  const fixture = setupRepoForAdvancedTools();
  try {
    const result = estimateChangedCoverage({
      repoPath: fixture.repoPath,
      baseBranch: fixture.baseBranch,
      workingBranch: fixture.workingBranch,
      targetOrg: "devOrg"
    });

    assert.equal(result.comparison, "main...feature/security-and-impact");
    assert.ok(result.mappings.some((m) => m.sourceType === "apex"));
    assert.ok(result.recommendedTests.includes("OrderServiceTest"));
    assert.ok(result.runCommand?.includes("--target-org devOrg"));
    assert.ok(["high", "medium", "low", "none"].includes(result.overallCoverageHint));
  } finally {
    fixture.cleanup();
  }
});

test("estimateChangedCoverage throws for invalid targetOrg", () => {
  const fixture = setupRepoForAdvancedTools();
  try {
    assert.throws(
      () => estimateChangedCoverage({
        repoPath: fixture.repoPath,
        baseBranch: fixture.baseBranch,
        workingBranch: fixture.workingBranch,
        targetOrg: "devOrg;whoami"
      }),
      /targetOrg validation failed/
    );
  } finally {
    fixture.cleanup();
  }
});

test("buildMetadataDependencyGraph detects references for deleted field metadata", () => {
  const fixture = setupRepoForMetadataDependency();
  try {
    const result = buildMetadataDependencyGraph({
      repoPath: fixture.repoPath,
      baseBranch: fixture.baseBranch,
      workingBranch: fixture.workingBranch,
      maxReferences: 20
    });

    assert.equal(result.comparison, "main...feature/remove-legacy-field");
    const target = result.targets.find((t) => t.apiName === "Invoice__c.LegacyCode__c");
    assert.ok(target);
    assert.equal(target?.status, "D");
    assert.ok((target?.references.length ?? 0) >= 1);
    assert.equal(target?.risk, "high");
  } finally {
    fixture.cleanup();
  }
});
