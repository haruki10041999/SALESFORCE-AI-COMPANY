import { isAbsolute, join, relative } from "node:path";

export interface OutputsDirWarningInput {
  root: string;
  outputsDirEnv?: string;
  resolvedOutputsDir: string;
}

export function getOutputsDirStartupWarnings(input: OutputsDirWarningInput): string[] {
  const warnings: string[] = [];
  const envValue = input.outputsDirEnv?.trim();
  const defaultOutputsDir = join(input.root, "outputs");

  if (!envValue) {
    warnings.push(
      `SF_AI_OUTPUTS_DIR is not set; using default outputs directory: ${defaultOutputsDir}`
    );
    return warnings;
  }

  if (!isAbsolute(envValue)) {
    warnings.push(
      `SF_AI_OUTPUTS_DIR is relative; resolved to absolute path: ${input.resolvedOutputsDir}`
    );
  }

  const relativeToRoot = relative(input.root, input.resolvedOutputsDir);
  const isOutsideRoot =
    relativeToRoot.length > 0 && (isAbsolute(relativeToRoot) || relativeToRoot.startsWith(".."));
  if (isOutsideRoot) {
    warnings.push(
      `SF_AI_OUTPUTS_DIR points outside the project root: ${input.resolvedOutputsDir}`
    );
  }

  return warnings;
}
