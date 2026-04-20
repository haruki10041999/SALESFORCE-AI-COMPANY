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
