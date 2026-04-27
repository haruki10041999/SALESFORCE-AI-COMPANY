/**
 * TASK-A6: エージェント協調スコア学習ストア。
 *
 * チャット終了時に参加エージェント組み合わせとスコアを
 * `outputs/learning/agent-synergy.jsonl` に追記し、
 * 次回の `dequeue_next_agent` 時に Bayesian average ベースで
 * bonus 加算できるようにする。
 *
 * ε-greedy 探索で局所最適を防ぐ (既定 ε = 0.1)。
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentSynergyRecord = {
  /** ISO 8601 タイムスタンプ */
  recordedAt: string;
  /** 参加エージェント名リスト (ソート済み) */
  agents: string[];
  /** チャット品質スコア (0–1, 省略時 null) */
  qualityScore?: number | null;
  /** セッション ID (任意) */
  sessionId?: string;
};

export type AgentSynergyBonus = {
  agentA: string;
  agentB: string;
  bonus: number;
};

// ---------------------------------------------------------------------------
// I/O helpers
// ---------------------------------------------------------------------------

const DEFAULT_PATH = "outputs/learning/agent-synergy.jsonl";

function resolvePath(filePath?: string): string {
  return resolve(filePath ?? DEFAULT_PATH);
}

function ensureDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** セッション終了時に記録を追記する。 */
export function recordAgentSynergySession(
  record: AgentSynergyRecord,
  filePath?: string
): void {
  const fp = resolvePath(filePath);
  ensureDir(fp);
  appendFileSync(fp, JSON.stringify(record) + "\n", "utf-8");
}

/** JSONL ファイルから全レコードをロードする。 */
export function loadAgentSynergyRecords(filePath?: string): AgentSynergyRecord[] {
  const fp = resolvePath(filePath);
  if (!existsSync(fp)) return [];
  const lines = readFileSync(fp, "utf-8").split("\n").filter(Boolean);
  const records: AgentSynergyRecord[] = [];
  for (const line of lines) {
    try {
      const rec = JSON.parse(line) as AgentSynergyRecord;
      if (Array.isArray(rec.agents)) records.push(rec);
    } catch {
      // skip malformed lines
    }
  }
  return records;
}

// ---------------------------------------------------------------------------
// Bayesian average bonus calculation (ε-greedy)
// ---------------------------------------------------------------------------

/**
 * 過去の記録から各エージェントペアの Bayesian average ボーナスを計算する。
 *
 * bonus = (Σ quality_i + m * μ_prior) / (N + m)
 *  - m: prior strength (既定 5)
 *  - μ_prior: 事前期待値 (既定 0.5)
 *  - ε: greedy 探索率 (既定 0.1) — epsilon 確率でランダム bonus を付与
 *
 * @returns ペアごとのボーナス配列 (bonus ∈ [0, 1])
 */
export function computeSynergyBonuses(
  records: AgentSynergyRecord[],
  options: {
    priorStrength?: number;
    priorMean?: number;
    epsilon?: number;
    maxBonus?: number;
  } = {}
): AgentSynergyBonus[] {
  const m = options.priorStrength ?? 5;
  const mu = options.priorMean ?? 0.5;
  const epsilon = options.epsilon ?? 0.1;
  const maxBonus = options.maxBonus ?? 0.15;

  type PairAccum = { sumQ: number; count: number };
  const pairMap = new Map<string, PairAccum>();

  for (const rec of records) {
    const agents = [...rec.agents].sort();
    const q = rec.qualityScore ?? mu;
    for (let i = 0; i < agents.length; i++) {
      for (let j = i + 1; j < agents.length; j++) {
        const key = `${agents[i]}\0${agents[j]}`;
        const prev = pairMap.get(key) ?? { sumQ: 0, count: 0 };
        pairMap.set(key, { sumQ: prev.sumQ + q, count: prev.count + 1 });
      }
    }
  }

  const bonuses: AgentSynergyBonus[] = [];
  for (const [key, accum] of pairMap) {
    const [agentA, agentB] = key.split("\0");
    if (!agentA || !agentB) continue;

    const bayesAvg = (accum.sumQ + m * mu) / (accum.count + m);
    // ε-greedy: with probability ε return a random bonus to encourage exploration
    const isExplore = Math.random() < epsilon;
    const rawBonus = isExplore ? Math.random() * maxBonus : bayesAvg * maxBonus;
    bonuses.push({
      agentA,
      agentB,
      bonus: Math.min(maxBonus, Math.max(0, rawBonus))
    });
  }

  return bonuses.sort((a, b) => b.bonus - a.bonus);
}

/**
 * 特定のエージェントに対するボーナスを取得する。
 * `computeSynergyBonuses` の結果から O(n) でルックアップ。
 */
export function getSynergyBonusForAgent(
  agentName: string,
  bonuses: AgentSynergyBonus[]
): number {
  let total = 0;
  for (const b of bonuses) {
    if (b.agentA === agentName || b.agentB === agentName) total += b.bonus;
  }
  return total;
}
