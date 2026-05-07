import { join, resolve } from "node:path";
import {
  loadOutputRatioFeedback,
  summarizeOutputRatioByModel,
  writePricingFromOutputRatioFeedback
} from "../mcp/core/learning/cost-feedback.js";

async function main(): Promise<void> {
  const outputsDir = process.env.SF_AI_OUTPUTS_DIR
    ? resolve(process.env.SF_AI_OUTPUTS_DIR)
    : resolve("outputs");

  const feedbackFile = join(outputsDir, "learning", "output-ratio.jsonl");
  const pricingFile = join(outputsDir, "pricing.json");

  const entries = await loadOutputRatioFeedback(feedbackFile);
  const summaries = summarizeOutputRatioByModel(entries, { minSamplesPerAgent: 2 });
  await writePricingFromOutputRatioFeedback(pricingFile, summaries);

  console.log(
    JSON.stringify(
      {
        synced: true,
        feedbackFile,
        pricingFile,
        modelCount: summaries.length,
        sampleCount: entries.length
      },
      null,
      2
    )
  );
}

void main();
