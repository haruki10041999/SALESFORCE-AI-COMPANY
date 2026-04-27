/**
 * TASK-A4: Context-Aware Skill 推薦。
 *
 * `recommend_skills_for_role` ツール:
 *  - 役割 (`role`) と任意の `topic` / `recentFiles` を入力に取り、
 *    スキル一覧から関連度順に上位 N を返す。
 *  - 既存の `scoreByQuery` を再利用しつつ、以下の文脈ボーナスを加点:
 *      role -> skill ディレクトリの static map (例: apex-developer -> apex)
 *      recentFiles の拡張子/path セグメントから推定したカテゴリ
 *  - 出力は `recommendations: [{ name, score, reasons[] }]` 形式で監査可能。
 *
 * skill 一覧は呼び出し側 (`listSkillsCatalog`) から `NamedSummary[]` を
 * 受け取り、本モジュール自体は I/O を持たない。
 */
import { scoreByQuery, type NamedSummary } from "../core/resource/topic-skill-ranking.js";

export type RecommendSkillsInput = {
  role?: string;
  topic?: string;
  recentFiles?: string[];
  limit?: number;
  /** Provided by caller (server.ts wires `listSkillsCatalog`). */
  skills: NamedSummary[];
};

export type SkillRecommendation = {
  name: string;
  score: number;
  reasons: string[];
};

export type RecommendSkillsResult = {
  inputSummary: {
    role?: string;
    topic?: string;
    recentFileCount: number;
  };
  recommendations: SkillRecommendation[];
};

const ROLE_TO_CATEGORIES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "apex-developer": ["apex", "testing", "performance"],
  "lwc-developer": ["lwc", "testing"],
  "flow-specialist": ["salesforce-platform", "testing"],
  "data-modeler": ["data-model", "salesforce-platform"],
  "integration-developer": ["integration", "security"],
  "performance-engineer": ["performance", "apex"],
  "qa-engineer": ["testing", "debug"],
  "debug-specialist": ["debug", "apex"],
  "refactor-specialist": ["refactor", "apex"],
  "security-engineer": ["security"],
  "devops-engineer": ["devops"],
  "documentation-writer": ["documentation"],
  "architect": ["architecture", "salesforce-platform"]
});

const FILE_EXT_TO_CATEGORIES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  cls: ["apex"],
  trigger: ["apex"],
  js: ["lwc"],
  html: ["lwc"],
  flow: ["salesforce-platform"],
  "permissionset-meta.xml": ["security"],
  "object-meta.xml": ["data-model"],
  "field-meta.xml": ["data-model"]
});

const PATH_SEGMENT_TO_CATEGORIES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  classes: ["apex"],
  triggers: ["apex"],
  lwc: ["lwc"],
  flows: ["salesforce-platform"],
  permissionsets: ["security"],
  objects: ["data-model"],
  testSuites: ["testing"]
});

const CONTEXT_BONUS = 10;
const TOPIC_WEIGHT = 1.0;

function categoriesForRole(role?: string): readonly string[] {
  if (!role) return [];
  return ROLE_TO_CATEGORIES[role.toLowerCase()] ?? [];
}

function categoriesForFile(filePath: string): string[] {
  const out = new Set<string>();
  const lower = filePath.toLowerCase().replace(/\\/g, "/");
  for (const [seg, cats] of Object.entries(PATH_SEGMENT_TO_CATEGORIES)) {
    if (lower.includes(`/${seg}/`)) cats.forEach((c) => out.add(c));
  }
  // Multi-part extension first (e.g. permissionset-meta.xml)
  for (const [ext, cats] of Object.entries(FILE_EXT_TO_CATEGORIES)) {
    if (lower.endsWith(`.${ext}`)) cats.forEach((c) => out.add(c));
  }
  return [...out];
}

function categoriesForRecentFiles(files?: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  if (!files) return counts;
  for (const f of files) {
    for (const cat of categoriesForFile(f)) {
      counts.set(cat, (counts.get(cat) ?? 0) + 1);
    }
  }
  return counts;
}

function skillCategory(skillName: string): string {
  // Skill names are stored as `<category>/<file>` by markdown-catalog.
  const idx = skillName.indexOf("/");
  return idx > 0 ? skillName.slice(0, idx) : skillName;
}

export function recommendSkillsForRole(input: RecommendSkillsInput): RecommendSkillsResult {
  const limit = Math.max(1, Math.min(50, input.limit ?? 5));
  const roleCategories = new Set(categoriesForRole(input.role));
  const fileCategoryCounts = categoriesForRecentFiles(input.recentFiles);

  const scored: SkillRecommendation[] = [];
  for (const skill of input.skills) {
    const reasons: string[] = [];
    let score = 0;

    if (input.topic && input.topic.trim().length > 0) {
      const topicScore = scoreByQuery(input.topic, skill.name, skill.summary) * TOPIC_WEIGHT;
      if (topicScore > 0) {
        score += topicScore;
        reasons.push(`topic-match:${topicScore.toFixed(1)}`);
      }
    }

    const cat = skillCategory(skill.name);
    if (roleCategories.has(cat)) {
      score += CONTEXT_BONUS;
      reasons.push(`role:${input.role}->${cat}`);
    }

    const fileHits = fileCategoryCounts.get(cat) ?? 0;
    if (fileHits > 0) {
      const bonus = CONTEXT_BONUS * Math.min(3, fileHits);
      score += bonus;
      reasons.push(`recent-files:${fileHits}->${cat}+${bonus}`);
    }

    if (score > 0) scored.push({ name: skill.name, score, reasons });
  }

  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return {
    inputSummary: {
      role: input.role,
      topic: input.topic,
      recentFileCount: input.recentFiles?.length ?? 0
    },
    recommendations: scored.slice(0, limit)
  };
}

// Visible for tests / external callers
export const __testables = {
  categoriesForRole,
  categoriesForFile,
  skillCategory
};
