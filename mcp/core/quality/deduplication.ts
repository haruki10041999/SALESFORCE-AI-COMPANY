/**
 * Deduplication
 * 
 * リソースの重複排除・類似度チェック
 */

/**
 * 類似度チェック結果
 */
export interface SimilarityCheckResult {
  isDuplicate: boolean;
  similarity: number; // 0-1
  similarResources: {
    name: string;
    similarity: number;
  }[];
}

/**
 * 単純な文字列類似度を計算（Levenshtein距離ベース）
 */
function levenshteinSimilarity(str1: string, str2: string): number {
  const normalized1 = str1.toLowerCase().trim();
  const normalized2 = str2.toLowerCase().trim();

  if (normalized1 === normalized2) return 1.0;

  const len1 = normalized1.length;
  const len2 = normalized2.length;
  const maxLen = Math.max(len1, len2);

  if (maxLen === 0) return 1.0;

  const matrix: number[][] = Array(len1 + 1)
    .fill(null)
    .map(() => Array(len2 + 1).fill(0));

  for (let i = 0; i <= len1; i++) matrix[i][0] = i;
  for (let j = 0; j <= len2; j++) matrix[0][j] = j;

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = normalized1[i - 1] === normalized2[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  const distance = matrix[len1][len2];
  return 1 - distance / maxLen;
}

/**
 * テキストコンテンツの類似度を計算（簡易版）
 */
function contentSimilarity(content1: string, content2: string): number {
  const norm1 = content1
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((t) => t.length > 3)
    .sort();

  const norm2 = content2
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((t) => t.length > 3)
    .sort();

  if (norm1.length === 0 && norm2.length === 0) return 1.0;
  if (norm1.length === 0 || norm2.length === 0) return 0.0;

  const intersection = new Set(norm1.filter((w) => norm2.includes(w)));
  const union = new Set([...norm1, ...norm2]);

  return intersection.size / union.size;
}

/**
 * リソース間の類似度を計算
 */
export function calculateSimilarity(
  resource1: {
    name: string;
    description?: string;
    summary?: string;
  },
  resource2: {
    name: string;
    description?: string;
    summary?: string;
  }
): number {
  // 名前の類似度（重み: 0.5）
  const nameSim = levenshteinSimilarity(resource1.name, resource2.name);

  // 説明の類似度（重み: 0.5）
  const desc1 = (resource1.description || resource1.summary || "").slice(0, 200);
  const desc2 = (resource2.description || resource2.summary || "").slice(0, 200);
  const descSim = desc1 && desc2 ? contentSimilarity(desc1, desc2) : 0;

  // 加重平均
  const weight1 = 0.5;
  const weight2 = desc1 && desc2 ? 0.5 : 0;

  if (weight1 + weight2 === 0) return nameSim;

  return (nameSim * weight1 + descSim * weight2) / (weight1 + weight2);
}

/**
 * リソースの重複チェック
 */
export function checkForDuplicates(
  newResource: {
    name: string;
    description?: string;
    summary?: string;
  },
  existingResources: Array<{
    name: string;
    description?: string;
    summary?: string;
  }>,
  threshold: number = 0.8
): SimilarityCheckResult {
  const similarities = existingResources.map((existing) => {
    const similarity = calculateSimilarity(newResource, existing);
    return {
      name: existing.name,
      similarity
    };
  });

  const duplicates = similarities.filter((s) => s.similarity >= threshold);
  const maxSimilarity = similarities.length > 0 ? Math.max(...similarities.map((s) => s.similarity)) : 0;

  return {
    isDuplicate: duplicates.length > 0,
    similarity: maxSimilarity,
    similarResources: similarities
      .filter((s) => s.similarity > 0.5)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 5)
  };
}

/**
 * 名前からのみ簡易重複チェック
 */
export function checkNameDuplicate(
  newName: string,
  existingNames: string[]
): boolean {
  const normalized = newName.toLowerCase().trim();
  return existingNames.some(
    (name) => name.toLowerCase().trim() === normalized
  );
}

/**
 * 重複を避けた新しい名前を生成
 */
export function generateUniqueName(
  baseName: string,
  existingNames: string[],
  maxAttempts: number = 10
): string {
  if (!checkNameDuplicate(baseName, existingNames)) {
    return baseName;
  }

  for (let i = 1; i <= maxAttempts; i++) {
    const candidate = `${baseName}-${i}`;
    if (!checkNameDuplicate(candidate, existingNames)) {
      return candidate;
    }
  }

  // 最終手段：タイムスタンプ付きで生成
  return `${baseName}-${Date.now().toString(36)}`;
}

/**
 * 複数リソース間の重複を検出
 */
export function findDuplicateGroups(
  resources: Array<{
    name: string;
    description?: string;
    summary?: string;
  }>,
  threshold: number = 0.8
): {
  groupId: number;
  resources: string[];
}[] {
  const groups: Map<number, Set<number>> = new Map();
  let groupCounter = 0;

  for (let i = 0; i < resources.length; i++) {
    for (let j = i + 1; j < resources.length; j++) {
      const similarity = calculateSimilarity(resources[i], resources[j]);
      if (similarity >= threshold) {
        // グループ化
        let foundGroup = false;
        for (const [gid, members] of groups.entries()) {
          if (members.has(i) || members.has(j)) {
            members.add(i);
            members.add(j);
            foundGroup = true;
            break;
          }
        }
        if (!foundGroup) {
          const newGroup = new Set([i, j]);
          groups.set(groupCounter++, newGroup);
        }
      }
    }
  }

  return Array.from(groups.entries()).map(([id, indices]) => ({
    groupId: id,
    resources: Array.from(indices).map((i) => resources[i].name)
  }));
}
