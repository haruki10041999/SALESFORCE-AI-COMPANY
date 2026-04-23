import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (!process.env.SF_AI_OUTPUTS_DIR) {
  const tempOutputsDir = mkdtempSync(join(tmpdir(), `sf-ai-test-${process.pid}-`));
  process.env.SF_AI_OUTPUTS_DIR = tempOutputsDir;

  const cleanup = () => {
    try {
      rmSync(tempOutputsDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup failure in tests
    }
  };

  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(130);
  });
}
