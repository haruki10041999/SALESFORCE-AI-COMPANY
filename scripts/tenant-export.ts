import { resolve } from "node:path";
import { exportTenant } from "../mcp/core/application/tenant/tenant-service.js";

function getArgValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index < 0) {
    return undefined;
  }
  return process.argv[index + 1];
}

async function main(): Promise<void> {
  const tenantId = getArgValue("--tenant-id") ?? process.argv[2];
  if (!tenantId) {
    throw new Error("tenant id is required: use --tenant-id <id>");
  }

  const rootDir = getArgValue("--root") ?? resolve(process.cwd());
  const snapshot = await exportTenant(rootDir, tenantId);
  console.log(JSON.stringify(snapshot, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
