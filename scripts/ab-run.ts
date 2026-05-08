#!/usr/bin/env node
import { parseArgs } from "util";
import { db } from "../db/client";
import { sessionHistoryTable } from "../db/schema/session-history";
import { abTestRunsTable } from "../db/schema/ab-test-runs";
import { ReplayABEvaluator } from "../mcp/core/learning/replay-ab";
import { VariantConfig } from "../mcp/core/learning/replay-ab";

/**
 * CLI: ab:run -- --variant <id> --sessions <range>
 *
 * Examples:
 *   npm run ai -- ab:run -- --variant prompt-v2 --sessions 1:5
 *   npm run ai -- ab:run -- --variant skill-swap-gpt4 --sessions all
 *   npm run ai -- ab:run -- --variant model-override-claude --sessions last:100
 */
async function main() {
  const args = parseArgs({
    options: {
      variant: { type: "string" },
      sessions: { type: "string", default: "last:10" },
      "dry-run": { type: "boolean", default: false },
    },
  });

  const { variant, sessions: sessionRange, "dry-run": dryRun } = args.values;

  if (!variant) {
    console.error("Error: --variant is required");
    console.error(
      "Usage: npm run ai -- ab:run -- --variant <id> --sessions <range>",
    );
    process.exit(1);
  }

  const evaluator = new ReplayABEvaluator();

  try {
    // Fetch sessions
    const fetchedSessions = await fetchSessions(sessionRange || "last:10");
    console.log(`Found ${fetchedSessions.length} sessions to evaluate`);

    if (fetchedSessions.length === 0) {
      console.log("No sessions to evaluate");
      process.exit(0);
    }

    // Load variant config (TODO: from proposal/preset store)
    const variantConfig = getVariantConfig(variant);

    // Run AB tests
    const results = [];
    for (const session of fetchedSessions) {
      console.log(
        `Testing ${variant} against session ${session.id.substring(0, 8)}...`,
      );

      // Parse session snapshot
      const snapshot = JSON.parse(session.snapshot || "{}");

      const result = await evaluator.runVariant(
        snapshot,
        variantConfig,
        variant,
        "prompt_template", // TODO: infer from variant ID
      );

      console.log(
        `  Control: ${result.controlScore.toFixed(1)} | Variant: ${result.variantScore.toFixed(1)} | Winner: ${result.winner}`,
      );
      results.push(result);

      if (!dryRun) {
        // Store result in database
        await db.insert(abTestRunsTable).values({
          tenant_id: session.tenant_id,
          session_id: session.id,
          variant_id: variant,
          variant_type: "prompt_template",
          variant_config: variantConfig as any,
          control_score: result.controlScore.toString(),
          variant_score: result.variantScore.toString(),
          winner: result.winner,
          score_diff: result.scoreDiff.toString(),
          is_statistically_significant: result.isSignificant,
          confidence_level: result.confidenceLevel.toString(),
          scorer_version: result.scorerVersion,
        });
      }
    }

    // Summary
    const variantWins = results.filter((r) => r.winner === "variant").length;
    const controlWins = results.filter((r) => r.winner === "control").length;
    const ties = results.filter((r) => r.winner === "tie").length;

    console.log("\n=== Summary ===");
    console.log(`Variant wins: ${variantWins}/${results.length}`);
    console.log(`Control wins: ${controlWins}/${results.length}`);
    console.log(`Ties: ${ties}/${results.length}`);

    const avgVariantScore =
      results.reduce((sum, r) => sum + r.variantScore, 0) / results.length;
    const avgControlScore =
      results.reduce((sum, r) => sum + r.controlScore, 0) / results.length;
    console.log(
      `Avg Score: Variant ${avgVariantScore.toFixed(1)} vs Control ${avgControlScore.toFixed(1)}`,
    );

    if (dryRun) {
      console.log("\n[DRY RUN] No results stored in database");
    }

    if (variantWins > controlWins) {
      console.log(
        `\n✓ Variant ${variant} is RECOMMENDED for promotion to governance`,
      );
      process.exit(0);
    } else {
      console.log(`\n✗ Variant ${variant} did not outperform control`);
      process.exit(1);
    }
  } catch (error) {
    console.error("Error during AB evaluation:", error);
    process.exit(1);
  }
}

/**
 * Parse session range and fetch from database
 * Formats: "1:5" | "all" | "last:10"
 */
async function fetchSessions(
  rangeStr: string,
): Promise<
  Array<{ id: string; tenant_id: string; snapshot: string | null }>
> {
  if (rangeStr === "all") {
    return await db
      .select({ id: sessionHistoryTable.id, tenant_id: sessionHistoryTable.tenant_id, snapshot: sessionHistoryTable.snapshot })
      .from(sessionHistoryTable)
      .limit(100);
  }

  if (rangeStr.startsWith("last:")) {
    const limit = parseInt(rangeStr.split(":")[1], 10);
    return await db
      .select({ id: sessionHistoryTable.id, tenant_id: sessionHistoryTable.tenant_id, snapshot: sessionHistoryTable.snapshot })
      .from(sessionHistoryTable)
      .orderBy(sessionHistoryTable.created_at)
      .limit(limit);
  }

  const [startStr, endStr] = rangeStr.split(":");
  const start = parseInt(startStr, 10);
  const end = parseInt(endStr || startStr, 10);

  return await db
    .select({ id: sessionHistoryTable.id, tenant_id: sessionHistoryTable.tenant_id, snapshot: sessionHistoryTable.snapshot })
    .from(sessionHistoryTable)
    .offset(start)
    .limit(end - start + 1);
}

/**
 * TODO: Load variant configuration from proposal store or file
 */
function getVariantConfig(variantId: string): VariantConfig {
  // Placeholder: would load from governance proposal / preset
  return {
    promptTemplate: {
      name: variantId,
      content: `You are a helpful assistant. [${variantId}]`,
    },
  };
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
