import { ensureGitRepoAndRefs, getDiffFiles, runGit, validateRef } from "./git-diff-helpers.js";

export type MetadataDependencyInput = {
  repoPath: string;
  baseBranch?: string;
  integrationBranch?: string;
  workingBranch: string;
  maxReferences?: number;
};

type TargetKind = "CustomField" | "CustomObject";
type TargetRisk = "high" | "medium" | "low";

export type DependencyReference = {
  filePath: string;
  line: number;
  snippet: string;
};

export type DependencyTarget = {
  kind: TargetKind;
  status: "A" | "M" | "D";
  sourcePath: string;
  apiName: string;
  objectApiName?: string;
  references: DependencyReference[];
  risk: TargetRisk;
};

export type MetadataDependencyResult = {
  comparison: string;
  targets: DependencyTarget[];
  summary: string;
};

function parseFieldFromPath(path: string): { objectApiName: string; fieldApiName: string } | null {
  const match = path.match(/\/objects\/([^/]+)\/fields\/([^/]+)\.field-meta\.xml$/i);
  if (!match) return null;
  return {
    objectApiName: match[1],
    fieldApiName: match[2]
  };
}

function parseObjectFromPath(path: string): { objectApiName: string } | null {
  const match = path.match(/\/objects\/([^/]+)\/[^/]+\.object-meta\.xml$/i);
  if (!match) return null;
  return {
    objectApiName: match[1]
  };
}

function listTrackableFiles(repoPath: string, ref: string): string[] {
  const output = runGit(repoPath, ["ls-tree", "-r", "--name-only", ref, "--", "force-app"]);
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => Boolean(line))
    .filter((line) => /\.cls$|\.trigger$|\.js$|\.ts$|\.flow-meta\.xml$|\.permissionset-meta\.xml$|\.profile-meta\.xml$/i.test(line));
}

function fileContentAtRef(repoPath: string, ref: string, filePath: string): string {
  try {
    return runGit(repoPath, ["show", `${ref}:${filePath}`]);
  } catch {
    return "";
  }
}

function collectReferences(
  repoPath: string,
  workingBranch: string,
  filePaths: string[],
  patterns: string[],
  maxReferences: number
): DependencyReference[] {
  const references: DependencyReference[] = [];

  for (const filePath of filePaths) {
    if (references.length >= maxReferences) break;

    const content = fileContentAtRef(repoPath, workingBranch, filePath);
    if (!content) continue;

    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (patterns.some((pattern) => line.includes(pattern))) {
        references.push({
          filePath,
          line: i + 1,
          snippet: line.trim().slice(0, 200)
        });
      }

      if (references.length >= maxReferences) break;
    }
  }

  return references;
}

function riskForTarget(status: "A" | "M" | "D", references: DependencyReference[]): TargetRisk {
  if (status === "D" && references.length > 0) return "high";
  if (references.length >= 5) return "medium";
  return references.length > 0 ? "low" : "low";
}

export function buildMetadataDependencyGraph(input: MetadataDependencyInput): MetadataDependencyResult {
  const { repoPath, workingBranch, maxReferences = 50 } = input;
  const baseBranch = input.baseBranch ?? input.integrationBranch;
  if (!baseBranch) {
    throw new Error("baseBranch is required");
  }

  validateRef(baseBranch, "baseBranch");
  validateRef(workingBranch, "workingBranch");
  ensureGitRepoAndRefs(repoPath, [baseBranch, workingBranch]);

  const comparison = `${baseBranch}...${workingBranch}`;
  const diffFiles = getDiffFiles(repoPath, comparison);
  const trackableFiles = listTrackableFiles(repoPath, workingBranch);

  const targets: DependencyTarget[] = [];

  for (const file of diffFiles) {
    const field = parseFieldFromPath(file.path);
    if (field) {
      const apiName = `${field.objectApiName}.${field.fieldApiName}`;
      const patterns = [apiName, field.fieldApiName];
      const references = collectReferences(repoPath, workingBranch, trackableFiles, patterns, maxReferences);
      targets.push({
        kind: "CustomField",
        status: file.status === "A" || file.status === "M" || file.status === "D" ? file.status : "M",
        sourcePath: file.path,
        apiName,
        objectApiName: field.objectApiName,
        references,
        risk: riskForTarget(file.status === "A" || file.status === "M" || file.status === "D" ? file.status : "M", references)
      });
      continue;
    }

    const object = parseObjectFromPath(file.path);
    if (object) {
      const patterns = [object.objectApiName];
      const references = collectReferences(repoPath, workingBranch, trackableFiles, patterns, maxReferences);
      targets.push({
        kind: "CustomObject",
        status: file.status === "A" || file.status === "M" || file.status === "D" ? file.status : "M",
        sourcePath: file.path,
        apiName: object.objectApiName,
        objectApiName: object.objectApiName,
        references,
        risk: riskForTarget(file.status === "A" || file.status === "M" || file.status === "D" ? file.status : "M", references)
      });
    }
  }

  const high = targets.filter((t) => t.risk === "high").length;
  const medium = targets.filter((t) => t.risk === "medium").length;
  const totalRefs = targets.reduce((acc, target) => acc + target.references.length, 0);

  const summary = [
    `比較: ${comparison}`,
    `依存対象: ${targets.length}件`,
    `参照検出: ${totalRefs}件`,
    `リスク内訳: high ${high} / medium ${medium} / low ${Math.max(0, targets.length - high - medium)}`
  ].join("\n");

  return {
    comparison,
    targets,
    summary
  };
}
