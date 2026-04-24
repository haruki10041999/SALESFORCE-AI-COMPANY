/**
 * Reinforcement Learning Feedback (TASK-047)
 *
 * 完了 trace + skill rating + proposal feedback を統合し、
 * multi-armed bandit (Thompson sampling, Beta(α, β) 事前分布) で
 * resource の探索/活用バランスを取る。
 *
 * - 各 arm = (resource name) で α (success+1) と β (failure+1) を保持
 * - select(): Beta(α, β) からサンプル → 最大値の arm を選ぶ
 * - exploration rate を強制したい場合は forcedExplorationRate で混合 (0..1)
 * - 既存 ranking と切替可能なよう、純粋関数として独立提供
 *
 * 出力スコアは「次に試して期待される平均報酬」(0..1)。
 * top-1 ではなく top-N を返すため、resource-selector の補正値として使える。
 */

export interface BanditArm {
  name: string;
  /** success + 1 */
  alpha: number;
  /** failure + 1 */
  beta: number;
}

export interface BanditState {
  arms: Map<string, BanditArm>;
}

export interface BanditFeedback {
  name: string;
  /** true = success / false = failure */
  reward: boolean;
  /** 重み (デフォルト 1)。skill rating など 0.5 のような連続値も渡せる */
  weight?: number;
}

export interface BanditSelectionOptions {
  /** 0..1。乱数生成器を差し替え可能 (テスト用) */
  rng?: () => number;
  /**
   * 0..1。この確率で「未経験 (alpha+beta が最小) の arm」を強制選択する。
   * 既知 arm が偏っていてもコールド資源を試すための保険。デフォルト 0
   */
  forcedExplorationRate?: number;
  /** 返す上位 N。デフォルト 1 */
  limit?: number;
}

export interface BanditSelectionResult {
  name: string;
  /** Thompson sampling で得たスコア (期待報酬) */
  sampledScore: number;
  /** posterior mean (α / (α+β)) */
  expectedReward: number;
  alpha: number;
  beta: number;
}

export function createBanditState(): BanditState {
  return { arms: new Map() };
}

/**
 * arm を初期化 (既存なら何もしない)。事前分布 Beta(1,1) = 一様分布。
 */
export function ensureArm(state: BanditState, name: string): BanditArm {
  let arm = state.arms.get(name);
  if (!arm) {
    arm = { name, alpha: 1, beta: 1 };
    state.arms.set(name, arm);
  }
  return arm;
}

/**
 * フィードバックを 1 件反映する。weight は分割加算 (例 0.5 success → α+0.5)。
 */
export function recordFeedback(state: BanditState, feedback: BanditFeedback): BanditArm {
  const arm = ensureArm(state, feedback.name);
  const w = Math.max(0, feedback.weight ?? 1);
  if (feedback.reward) {
    arm.alpha += w;
  } else {
    arm.beta += w;
  }
  return arm;
}

/**
 * 複数フィードバックを bulk で反映。
 */
export function recordFeedbacks(state: BanditState, feedbacks: BanditFeedback[]): void {
  for (const f of feedbacks) recordFeedback(state, f);
}

/**
 * Box-Muller 等を用いず、Marsaglia-Tsang Gamma サンプラから Beta を作る。
 * 大きい α/β でも近似精度を保ち、純粋関数 (rng 注入) なのでテスト容易。
 */
function sampleGamma(shape: number, rng: () => number): number {
  if (shape < 1) {
    // Johnk's method の代替: shape += 1 してから x * U^(1/shape)
    const g = sampleGamma(shape + 1, rng);
    const u = Math.max(rng(), Number.EPSILON);
    return g * Math.pow(u, 1 / shape);
  }
  // Marsaglia & Tsang
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  // Box-Muller で標準正規
  const stdNormal = (): number => {
    const u1 = Math.max(rng(), Number.EPSILON);
    const u2 = rng();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };
  let attempts = 0;
  while (attempts < 1000) {
    attempts += 1;
    let x = stdNormal();
    let v = 1 + c * x;
    if (v <= 0) continue;
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
  // フォールバック: posterior mean
  return d;
}

function sampleBeta(alpha: number, beta: number, rng: () => number): number {
  const x = sampleGamma(alpha, rng);
  const y = sampleGamma(beta, rng);
  if (x + y === 0) return 0.5;
  return x / (x + y);
}

/**
 * Thompson sampling で top-N の arm を返す。
 *
 * candidateNames を渡すと、その arm のみから選ぶ (未学習なら on the fly で初期化)。
 * 渡さない場合は state 内全 arm から選ぶ。
 */
export function selectArms(
  state: BanditState,
  candidateNames: string[] | null,
  options: BanditSelectionOptions = {}
): BanditSelectionResult[] {
  const rng = options.rng ?? Math.random;
  const limit = options.limit ?? 1;
  const explorationRate = clamp01(options.forcedExplorationRate ?? 0);

  const targets: BanditArm[] = [];
  if (candidateNames && candidateNames.length > 0) {
    for (const name of candidateNames) {
      targets.push(ensureArm(state, name));
    }
  } else {
    for (const arm of state.arms.values()) targets.push(arm);
  }
  if (targets.length === 0) return [];

  let scored: BanditSelectionResult[];

  // 強制 exploration: 確率 explorationRate で「最も学習量が少ない arm」を先頭に
  const forceExplore = rng() < explorationRate;
  if (forceExplore) {
    const coldest = [...targets].sort(
      (a, b) => a.alpha + a.beta - (b.alpha + b.beta)
    )[0];
    const rest = targets.filter((t) => t.name !== coldest.name);
    scored = [coldest, ...rest].map((arm) => buildResult(arm, rng));
    // 先頭は固定し、残りは sampledScore でソート
    const head = scored[0];
    const tail = scored.slice(1).sort((a, b) => b.sampledScore - a.sampledScore);
    scored = [head, ...tail];
  } else {
    scored = targets
      .map((arm) => buildResult(arm, rng))
      .sort((a, b) => b.sampledScore - a.sampledScore);
  }

  return scored.slice(0, limit);
}

function buildResult(arm: BanditArm, rng: () => number): BanditSelectionResult {
  const sampledScore = sampleBeta(arm.alpha, arm.beta, rng);
  const expectedReward = arm.alpha / (arm.alpha + arm.beta);
  return {
    name: arm.name,
    sampledScore,
    expectedReward,
    alpha: arm.alpha,
    beta: arm.beta
  };
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

/**
 * snapshot を JSON-safe に出力する。
 */
export function toBanditSnapshot(state: BanditState): { arms: BanditArm[] } {
  return { arms: [...state.arms.values()].map((a) => ({ ...a })) };
}

export function fromBanditSnapshot(snapshot: { arms: BanditArm[] }): BanditState {
  const state = createBanditState();
  for (const a of snapshot.arms) {
    if (typeof a.name !== "string") continue;
    state.arms.set(a.name, {
      name: a.name,
      alpha: typeof a.alpha === "number" && a.alpha > 0 ? a.alpha : 1,
      beta: typeof a.beta === "number" && a.beta > 0 ? a.beta : 1
    });
  }
  return state;
}

/**
 * trace 完了 + proposal feedback を BanditFeedback に正規化するヘルパ。
 *
 * - trace.status === "success" → reward true, "error" → reward false
 * - proposal feedback の decision === "accepted" → reward true, それ以外 → false
 */
export interface RawTraceFeedbackInput {
  resourceName: string;
  status: "running" | "success" | "error";
}

export function tracesToFeedbacks(records: RawTraceFeedbackInput[]): BanditFeedback[] {
  const out: BanditFeedback[] = [];
  for (const r of records) {
    if (r.status === "running") continue;
    if (!r.resourceName) continue;
    out.push({ name: r.resourceName, reward: r.status === "success" });
  }
  return out;
}
