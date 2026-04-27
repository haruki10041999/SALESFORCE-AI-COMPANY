#!/usr/bin/env -S node --import tsx
/**
 * T-ADD-07: skill 自動分類 + 関連スキルリンク生成スクリプト。
 *
 * 各 skill markdown を読み、本文 (frontmatter / 見出しを含む) から embedding を構築し、
 *   - 既存カテゴリディレクトリ (skills/<category>/) との cosine 類似度で「推奨カテゴリ」を算出
 *   - スキル同士の上位 N の関連スキルを抽出
 * を outputs/reports/skill-auto-classify.json に書き出す。
 *
 * 実行: `npx tsx scripts/skill-auto-classify.ts [--top=3] [--threshold=0.05]`
 *
 * 副作用なし: 既存ファイルを書き換えず、出力 JSON のみを生成する。
 */
import { readdir, readFile, mkdir, writeFile, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildEmbedding,
  cosineSimilarity
} from "../mcp/core/resource/embedding-ranker.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const skillsDir = resolve(repoRoot, "skills");
const outputPath = resolve(repoRoot, "outputs", "reports", "skill-auto-classify.json");

interface SkillEntry {
  name: string;
  category: string;
  filePath: string;
  text: string;
}

function parseArgs(): { top: number; threshold: number } {
  let top = 3;
  let threshold = 0.05;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--top=")) top = Math.max(1, Number(arg.slice(6)) || 3);
    if (arg.startsWith("--threshold=")) threshold = Math.max(0, Number(arg.slice(12)) || 0.05);
  }
  return { top, threshold };
}

async function loadSkills(): Promise<SkillEntry[]> {
  const entries = await readdir(skillsDir, { withFileTypes: true });
  const skills: SkillEntry[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const category = entry.name;
    const catDir = join(skillsDir, category);
    const files = await readdir(catDir);
    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      const filePath = join(catDir, file);
      const st = await stat(filePath);
      if (!st.isFile()) continue;
      const text = await readFile(filePath, "utf-8");
      skills.push({
        name: file.replace(/\.md$/, ""),
        category,
        filePath,
        text
      });
    }
  }
  return skills;
}

interface ClassifyResult {
  skill: string;
  currentCategory: string;
  suggestedCategory: string;
  confidence: number;
  recategorize: boolean;
  topRelated: Array<{ skill: string; category: string; similarity: number }>;
}

async function main(): Promise<void> {
  const { top, threshold } = parseArgs();
  const skills = await loadSkills();
  if (skills.length === 0) {
    console.warn("no skills found under skills/");
    return;
  }

  // category centroid: 同カテゴリ全 skill の embedding を term 加算で集約する。
  const skillEmbeds = new Map<string, ReturnType<typeof buildEmbedding>>();
  for (const s of skills) skillEmbeds.set(`${s.category}/${s.name}`, buildEmbedding(s.text));

  const categoryCentroid = new Map<string, ReturnType<typeof buildEmbedding>>();
  for (const s of skills) {
    const key = s.category;
    const emb = skillEmbeds.get(`${s.category}/${s.name}`)!;
    let cur = categoryCentroid.get(key);
    if (!cur) {
      cur = { terms: new Map<string, number>(), norm: 0 };
      categoryCentroid.set(key, cur);
    }
    for (const [tok, w] of emb.terms) {
      cur.terms.set(tok, (cur.terms.get(tok) ?? 0) + w);
    }
  }
  // norm 再計算
  for (const centroid of categoryCentroid.values()) {
    let sumSq = 0;
    for (const v of centroid.terms.values()) sumSq += v * v;
    centroid.norm = Math.sqrt(sumSq);
  }

  const results: ClassifyResult[] = [];
  for (const skill of skills) {
    const emb = skillEmbeds.get(`${skill.category}/${skill.name}`)!;
    // category 推奨
    let bestCategory = skill.category;
    let bestSim = -Infinity;
    for (const [cat, centroid] of categoryCentroid) {
      const sim = cosineSimilarity(emb, centroid);
      if (sim > bestSim) {
        bestSim = sim;
        bestCategory = cat;
      }
    }
    // 関連 skill: 自分以外で類似度上位 N
    const relations: Array<{ skill: string; category: string; similarity: number }> = [];
    for (const other of skills) {
      if (other === skill) continue;
      const otherEmb = skillEmbeds.get(`${other.category}/${other.name}`)!;
      const sim = cosineSimilarity(emb, otherEmb);
      if (sim < threshold) continue;
      relations.push({ skill: other.name, category: other.category, similarity: Number(sim.toFixed(4)) });
    }
    relations.sort((a, b) => b.similarity - a.similarity);

    results.push({
      skill: skill.name,
      currentCategory: skill.category,
      suggestedCategory: bestCategory,
      confidence: Number(bestSim.toFixed(4)),
      recategorize: bestCategory !== skill.category,
      topRelated: relations.slice(0, top)
    });
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        skillCount: skills.length,
        topRelatedPerSkill: top,
        threshold,
        results
      },
      null,
      2
    ),
    "utf-8"
  );

  const moves = results.filter((r) => r.recategorize).length;
  console.log(`OK: classified ${skills.length} skill(s), ${moves} recategorization candidate(s).`);
  console.log(`     wrote: ${relative(repoRoot, outputPath)}`);
}

main().catch((err) => {
  console.error("skill-auto-classify failed:", err);
  process.exit(1);
});
