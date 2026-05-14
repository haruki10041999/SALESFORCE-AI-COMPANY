#!/usr/bin/env tsx
import { parseArgs } from "node:util";
import { getPrimaryDatabaseUrl } from "../mcp/core/config/runtime-config.js";
import { VectorLifecycleScheduler } from "../mcp/core/memory/lifecycle-scheduler.js";

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      limit: { type: "string" },
      "hot-to-warm-days": { type: "string" },
      "warm-to-cold-days": { type: "string" },
      "database-url": { type: "string" }
    },
    allowPositionals: false
  });

  const databaseUrl = values["database-url"]?.trim() || getPrimaryDatabaseUrl();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL or --database-url is required");
  }

  const hotToWarmDays = Number.parseInt(values["hot-to-warm-days"] ?? "7", 10);
  const warmToColdDays = Number.parseInt(values["warm-to-cold-days"] ?? "90", 10);
  const limit = Number.parseInt(values.limit ?? "2000", 10);

  const scheduler = new VectorLifecycleScheduler({
    databaseUrl,
    policy: {
      hotToWarmDays: Number.isFinite(hotToWarmDays) && hotToWarmDays > 0 ? hotToWarmDays : 7,
      warmToColdDays: Number.isFinite(warmToColdDays) && warmToColdDays > 0 ? warmToColdDays : 90
    }
  });

  try {
    const report = await scheduler.runOnce(Number.isFinite(limit) && limit > 0 ? limit : 2000);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await scheduler.stop();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
