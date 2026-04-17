import fs from "node:fs";
import path from "node:path";

export type RepoAnalysis = {
  apex: string[];
  lwc: string[];
  objects: string[];
};

export function analyzeRepo(root: string): RepoAnalysis {
  const result: RepoAnalysis = {
    apex: [],
    lwc: [],
    objects: []
  };

  function scan(dir: string): void {
    const files = fs.readdirSync(dir);

    for (const file of files) {
      const full = path.join(dir, file);
      const stat = fs.statSync(full);

      if (stat.isDirectory()) {
        scan(full);
        continue;
      }

      if (file.endsWith(".cls")) {
        result.apex.push(full);
      }

      if (full.includes(`${path.sep}lwc${path.sep}`) && file.endsWith(".js")) {
        result.lwc.push(full);
      }

      if (file.endsWith(".object-meta.xml")) {
        result.objects.push(full);
      }
    }
  }

  scan(root);
  return result;
}
