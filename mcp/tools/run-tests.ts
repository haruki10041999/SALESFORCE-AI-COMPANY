export function buildTestCommand(targetOrg: string): string {
  return `sf apex run test --target-org ${targetOrg} --result-format human --code-coverage --wait 30`;
}
