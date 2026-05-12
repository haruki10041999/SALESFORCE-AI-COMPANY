import { existsSync, readdirSync, readFileSync, statSync, type Dirent } from "node:fs";
import { join, relative } from "node:path";
import { shouldSkipScanDir } from "../../../quality/scan-exclusions.js";
import type { SecurityScanInput } from "../../../../tools/security-rule-scan.js";

/**
 * Apex / Trigger ファイルを再帰収集し、`{filePath, source}` の配列で返す。
 */
export function collectApexSources(rootDir: string, includeTests = false, sampleLimit?: number): SecurityScanInput[] {
  const out: SecurityScanInput[] = [];
  if (!existsSync(rootDir)) return out;
  const stack: string[] = [rootDir];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    let entries: Dirent[];
    try {
      entries = readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (shouldSkipScanDir(entry.name)) continue;
        stack.push(join(cur, entry.name));
        continue;
      }
      const name = entry.name.toLowerCase();
      if (!name.endsWith(".cls") && !name.endsWith(".trigger")) continue;
      const filePath = join(cur, entry.name);
      try {
        const st = statSync(filePath);
        if (!st.isFile()) continue;
        const source = readFileSync(filePath, "utf-8");
        if (!includeTests && /@isTest\b/i.test(source)) continue;
        out.push({ filePath: relative(rootDir, filePath) || filePath, source });
        if (sampleLimit && out.length >= sampleLimit) return out;
      } catch {
        continue;
      }
    }
  }
  return out;
}
