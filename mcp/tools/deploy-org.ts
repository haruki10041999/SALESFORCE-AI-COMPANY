export type DeployResult = {
  command: string;
  dryRun: boolean;
};

export function buildDeployCommand(targetOrg: string, dryRun = true): DeployResult {
  const command = dryRun
    ? `sf project deploy start --target-org ${targetOrg} --source-dir force-app --check-only --test-level RunLocalTests`
    : `sf project deploy start --target-org ${targetOrg} --source-dir force-app --test-level RunLocalTests`;

  return { command, dryRun };
}
