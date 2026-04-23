import {
  OrgIdentifierSchema,
  SafeFilePathSchema,
  runSchemaValidation
} from "../core/quality/resource-validation.js";

export type DeployInput = {
  targetOrg: string;
  dryRun?: boolean;
  sourceDir?: string;
  testLevel?: "NoTestRun" | "RunLocalTests" | "RunAllTestsInOrg" | "RunSpecifiedTests";
  specificTests?: string[];
  wait?: number;
  ignoreWarnings?: boolean;
};

export type DeployResult = {
  command: string;
  dryRun: boolean;
};

function assertSafeCliValue(value: string, fieldName: string): void {
  if (/[;&|`$<>\\"\n\r]/.test(value)) {
    throw new Error(
      `${fieldName} に使用できない文字が含まれています。英数字・ハイフン・アンダースコア・ドットのみ許可されます。`
    );
  }
}

export function buildDeployCommand(
  targetOrgOrInput: string | DeployInput,
  dryRun = true
): DeployResult {
  const input: DeployInput =
    typeof targetOrgOrInput === "string"
      ? { targetOrg: targetOrgOrInput, dryRun }
      : targetOrgOrInput;

  const {
    targetOrg,
    dryRun: dr = true,
    sourceDir = "force-app",
    testLevel = "RunLocalTests",
    specificTests,
    wait = 33,
    ignoreWarnings = false
  } = input;

  assertSafeCliValue(targetOrg, "targetOrg");
  assertSafeCliValue(sourceDir, "sourceDir");
  const orgCheck = runSchemaValidation(OrgIdentifierSchema, targetOrg);
  if (!orgCheck.success) {
    throw new Error(`targetOrg validation failed: ${orgCheck.errors.join(", ")}`);
  }
  const dirCheck = runSchemaValidation(SafeFilePathSchema, sourceDir);
  if (!dirCheck.success) {
    throw new Error(`sourceDir validation failed: ${dirCheck.errors.join(", ")}`);
  }
  if (specificTests) {
    for (const t of specificTests) {
      assertSafeCliValue(t, "specificTests");
    }
  }

  const parts = [
    `sf project deploy start`,
    `--target-org ${targetOrg}`,
    `--source-dir ${sourceDir}`,
    dr ? "--check-only" : "",
    `--test-level ${testLevel}`,
    testLevel === "RunSpecifiedTests" && specificTests && specificTests.length > 0
      ? `--tests ${specificTests.join(",")}`
      : "",
    `--wait ${wait}`,
    ignoreWarnings ? "--ignore-warnings" : ""
  ].filter(Boolean);

  return { command: parts.join(" "), dryRun: dr };
}
