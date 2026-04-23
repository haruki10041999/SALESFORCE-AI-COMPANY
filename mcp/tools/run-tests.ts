import {
  OrgIdentifierSchema,
  SafeFilePathSchema,
  runSchemaValidation
} from "../core/quality/resource-validation.js";

export type RunTestsInput = {
  targetOrg: string;
  classNames?: string[];
  suiteName?: string;
  wait?: number;
  outputDir?: string;
};

function assertSafeCliValue(value: string, fieldName: string): void {
  if (/[;&|`$<>\\"\n\r]/.test(value)) {
    throw new Error(
      `${fieldName} に使用できない文字が含まれています。英数字・ハイフン・アンダースコア・ドットのみ許可されます。`
    );
  }
}

export function buildTestCommand(
  targetOrgOrInput: string | RunTestsInput
): string {
  const input: RunTestsInput =
    typeof targetOrgOrInput === "string"
      ? { targetOrg: targetOrgOrInput }
      : targetOrgOrInput;

  const {
    targetOrg,
    classNames,
    suiteName,
    wait = 30,
    outputDir
  } = input;

  assertSafeCliValue(targetOrg, "targetOrg");
  const orgCheck = runSchemaValidation(OrgIdentifierSchema, targetOrg);
  if (!orgCheck.success) {
    throw new Error(`targetOrg validation failed: ${orgCheck.errors.join(", ")}`);
  }
  if (classNames) {
    for (const c of classNames) {
      assertSafeCliValue(c, "classNames");
    }
  }
  if (suiteName) assertSafeCliValue(suiteName, "suiteName");
  if (outputDir) {
    assertSafeCliValue(outputDir, "outputDir");
    const outCheck = runSchemaValidation(SafeFilePathSchema, outputDir);
    if (!outCheck.success) {
      throw new Error(`outputDir validation failed: ${outCheck.errors.join(", ")}`);
    }
  }

  const parts = [
    `sf apex run test`,
    `--target-org ${targetOrg}`,
    classNames && classNames.length > 0 ? `--class-names ${classNames.join(",")}` : "",
    suiteName ? `--suite-names ${suiteName}` : "",
    `--result-format human`,
    `--code-coverage`,
    `--wait ${wait}`,
    outputDir ? `--output-dir ${outputDir}` : ""
  ].filter(Boolean);

  return parts.join(" ");
}
