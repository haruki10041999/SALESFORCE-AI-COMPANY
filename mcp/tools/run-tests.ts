import {
  validateOrgIdentifier,
  validateSafeCliValue,
  validateSafeFilePath
} from "../core/quality/resource-validation.js";

export type RunTestsInput = {
  targetOrg: string;
  classNames?: string[];
  suiteName?: string;
  wait?: number;
  outputDir?: string;
};

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

  validateOrgIdentifier(targetOrg, "targetOrg");
  if (classNames) {
    for (const c of classNames) {
      validateSafeCliValue(c, "classNames");
    }
  }
  if (suiteName) validateSafeCliValue(suiteName, "suiteName");
  if (outputDir) {
    validateSafeFilePath(outputDir, "outputDir");
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
