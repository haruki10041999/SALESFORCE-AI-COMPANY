import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ModelRegistrySnapshot } from "./model-registry.js";
import { appendTextFileAtomic } from "../persistence/unit-of-work.js";

export interface LearningPromotionDagNode {
  node: "drift-check" | "ab-evaluation" | "policy-snapshot" | "promotion";
  status: "passed" | "skipped" | "failed";
  detail: string;
}

export interface LearningPromotionHistoryEntry {
  modelName: string;
  stage: "shadow" | "canary" | "proposal_required" | "promoted" | "rolled_back" | "held";
  action: "none" | "start_canary" | "queue_proposal" | "promote" | "rollback" | "reject_candidate";
  reason: string;
  candidateVersion?: string;
  currentProductionVersion: string;
  previousVersion?: string;
  policySnapshotTag?: string;
  dag: LearningPromotionDagNode[];
  occurredAt: string;
}

export interface PolicySnapshotTagInput {
  modelName: string;
  candidateVersion: string;
  productionVersion: string;
  reason: string;
  snapshot: ModelRegistrySnapshot;
}

export function resolveLearningPromotionHistoryPath(rootDir: string): string {
  return join(rootDir, "outputs", "learning", "promotion-history.jsonl");
}

export function resolvePolicySnapshotDirectory(rootDir: string): string {
  return join(rootDir, "outputs", "learning", "policy-snapshots");
}

export function buildPolicySnapshotTag(modelName: string, candidateVersion: string, now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  return `policy-snapshot:${modelName}@${candidateVersion}:${stamp}`;
}

export async function appendLearningPromotionHistory(
  filePath: string,
  entry: LearningPromotionHistoryEntry
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await appendTextFileAtomic(filePath, JSON.stringify(entry) + "\n");
}

export async function loadLearningPromotionHistory(
  filePath: string,
  limit = 50
): Promise<LearningPromotionHistoryEntry[]> {
  if (!existsSync(filePath)) {
    return [];
  }

  try {
    const raw = await readFile(filePath, "utf-8");
    const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
    const parsed: LearningPromotionHistoryEntry[] = [];
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as LearningPromotionHistoryEntry;
        if (typeof entry?.modelName !== "string" || typeof entry?.occurredAt !== "string") {
          continue;
        }
        parsed.push(entry);
      } catch {
        // Ignore malformed lines and continue.
      }
    }
    return parsed.slice(-Math.max(1, limit)).reverse();
  } catch {
    return [];
  }
}

export async function createPolicySnapshotTag(
  snapshotDir: string,
  input: PolicySnapshotTagInput
): Promise<string> {
  await mkdir(snapshotDir, { recursive: true });
  const tag = buildPolicySnapshotTag(input.modelName, input.candidateVersion);
  const fileName = tag.replace(/[^a-zA-Z0-9._@:-]/g, "-").replace(/[:]/g, "_") + ".json";
  const payload = {
    tag,
    modelName: input.modelName,
    candidateVersion: input.candidateVersion,
    productionVersion: input.productionVersion,
    reason: input.reason,
    createdAt: new Date().toISOString(),
    snapshot: input.snapshot
  };
  await writeFile(join(snapshotDir, fileName), JSON.stringify(payload, null, 2), "utf-8");
  return tag;
}
