import fs from "node:fs";
import path from "node:path";
import { SafeFilePathSchema, runSchemaValidation } from "../core/quality/resource-validation.js";

export type RepoAnalysis = {
  apex: string[];
  lwc: string[];
  objects: string[];
};

function isApexFile(fileName: string): boolean {
  return fileName.endsWith(".cls") || fileName.endsWith(".trigger");
}

/**
 * Normalize path to POSIX format (forward slashes)
 */
function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join("/");
}

export function analyzeRepo(root: string): RepoAnalysis {
  const pathCheck = runSchemaValidation(SafeFilePathSchema, root);
  if (!pathCheck.success) {
    throw new Error(`Invalid path: ${pathCheck.errors.join(", ")}`);
  }

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

      if (isApexFile(file)) {
        result.apex.push(toPosixPath(full));
      }

      // Use posix path for check
      const posixFull = toPosixPath(full);
      if (posixFull.includes("/lwc/") && file.endsWith(".js")) {
        result.lwc.push(posixFull);
      }

      if (file.endsWith(".object-meta.xml")) {
        result.objects.push(toPosixPath(full));
      }
    }
  }

  scan(root);
  return result;
}
