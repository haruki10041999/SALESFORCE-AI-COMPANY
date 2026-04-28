export interface LinUcbArm {
  name: string;
  A: number[][];
  b: number[];
  pulls: number;
  totalReward: number;
}

export interface LinUcbState {
  dimension: number;
  arms: Map<string, LinUcbArm>;
}

export interface LinUcbRankInput {
  name: string;
  features: number[];
}

export interface LinUcbRankResult {
  name: string;
  score: number;
  mean: number;
  bonus: number;
  pulls: number;
  avgReward: number;
}

export interface LinUcbSnapshot {
  dimension: number;
  arms: Array<{
    name: string;
    A: number[][];
    b: number[];
    pulls: number;
    totalReward: number;
  }>;
}

function createIdentity(n: number): number[][] {
  const m: number[][] = [];
  for (let i = 0; i < n; i += 1) {
    const row = new Array<number>(n).fill(0);
    row[i] = 1;
    m.push(row);
  }
  return m;
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) s += (a[i] ?? 0) * (b[i] ?? 0);
  return s;
}

function matVec(A: number[][], x: number[]): number[] {
  return A.map((row) => dot(row, x));
}

function invertMatrix(input: number[][]): number[][] {
  const n = input.length;
  const A = input.map((r) => [...r]);
  const I = createIdentity(n);

  for (let i = 0; i < n; i += 1) {
    // pivot selection
    let pivotRow = i;
    let maxAbs = Math.abs(A[i][i] ?? 0);
    for (let r = i + 1; r < n; r += 1) {
      const v = Math.abs(A[r][i] ?? 0);
      if (v > maxAbs) {
        maxAbs = v;
        pivotRow = r;
      }
    }

    if (maxAbs < 1e-12) {
      // ridge regularization fallback
      A[i][i] = (A[i][i] ?? 0) + 1e-6;
      maxAbs = Math.abs(A[i][i]);
      if (maxAbs < 1e-12) {
        throw new Error("matrix inversion failed: singular matrix");
      }
    }

    if (pivotRow !== i) {
      [A[i], A[pivotRow]] = [A[pivotRow], A[i]];
      [I[i], I[pivotRow]] = [I[pivotRow], I[i]];
    }

    const pivot = A[i][i];
    for (let c = 0; c < n; c += 1) {
      A[i][c] /= pivot;
      I[i][c] /= pivot;
    }

    for (let r = 0; r < n; r += 1) {
      if (r === i) continue;
      const factor = A[r][i];
      if (factor === 0) continue;
      for (let c = 0; c < n; c += 1) {
        A[r][c] -= factor * A[i][c];
        I[r][c] -= factor * I[i][c];
      }
    }
  }

  return I;
}

function validateFeatures(features: number[], dimension: number): void {
  if (features.length !== dimension) {
    throw new Error(`feature dimension mismatch: expected ${dimension}, got ${features.length}`);
  }
  for (const v of features) {
    if (!Number.isFinite(v)) {
      throw new Error("feature vector contains non-finite values");
    }
  }
}

export function createLinUcbState(dimension: number, armNames: string[] = []): LinUcbState {
  if (!Number.isInteger(dimension) || dimension <= 0) {
    throw new Error("dimension must be a positive integer");
  }
  const state: LinUcbState = { dimension, arms: new Map() };
  for (const name of armNames) ensureLinUcbArm(state, name);
  return state;
}

export function ensureLinUcbArm(state: LinUcbState, name: string): LinUcbArm {
  let arm = state.arms.get(name);
  if (!arm) {
    arm = {
      name,
      A: createIdentity(state.dimension),
      b: new Array<number>(state.dimension).fill(0),
      pulls: 0,
      totalReward: 0
    };
    state.arms.set(name, arm);
  }
  return arm;
}

export function updateLinUcbArm(
  state: LinUcbState,
  name: string,
  features: number[],
  reward: number
): LinUcbArm {
  validateFeatures(features, state.dimension);
  if (!Number.isFinite(reward)) {
    throw new Error("reward must be finite");
  }

  const arm = ensureLinUcbArm(state, name);
  for (let i = 0; i < state.dimension; i += 1) {
    for (let j = 0; j < state.dimension; j += 1) {
      arm.A[i][j] += features[i] * features[j];
    }
    arm.b[i] += reward * features[i];
  }
  arm.pulls += 1;
  arm.totalReward += reward;
  return arm;
}

export function scoreLinUcbArm(
  state: LinUcbState,
  name: string,
  features: number[],
  alpha = 1
): LinUcbRankResult {
  validateFeatures(features, state.dimension);
  const arm = ensureLinUcbArm(state, name);
  const invA = invertMatrix(arm.A);
  const theta = matVec(invA, arm.b);
  const mean = dot(theta, features);
  const variance = Math.max(0, dot(features, matVec(invA, features)));
  const bonus = Math.max(0, alpha) * Math.sqrt(variance);
  const score = mean + bonus;
  return {
    name,
    score,
    mean,
    bonus,
    pulls: arm.pulls,
    avgReward: arm.pulls > 0 ? arm.totalReward / arm.pulls : 0
  };
}

export function rankLinUcbArms(
  state: LinUcbState,
  inputs: LinUcbRankInput[],
  alpha = 1,
  limit?: number
): LinUcbRankResult[] {
  const scored = inputs
    .map((input) => scoreLinUcbArm(state, input.name, input.features, alpha))
    .sort((a, b) => b.score - a.score);
  if (!limit || limit <= 0) return scored;
  return scored.slice(0, limit);
}

export function toLinUcbSnapshot(state: LinUcbState): LinUcbSnapshot {
  return {
    dimension: state.dimension,
    arms: [...state.arms.values()].map((arm) => ({
      name: arm.name,
      A: arm.A.map((row) => [...row]),
      b: [...arm.b],
      pulls: arm.pulls,
      totalReward: arm.totalReward
    }))
  };
}

export function fromLinUcbSnapshot(snapshot: LinUcbSnapshot): LinUcbState {
  const state = createLinUcbState(snapshot.dimension);
  for (const arm of snapshot.arms ?? []) {
    if (!arm || typeof arm.name !== "string") continue;
    if (!Array.isArray(arm.A) || !Array.isArray(arm.b)) continue;
    if (arm.A.length !== state.dimension || arm.b.length !== state.dimension) continue;
    const safeA = arm.A.map((row, i) => {
      const out = new Array<number>(state.dimension).fill(0);
      for (let j = 0; j < state.dimension; j += 1) {
        const v = Number(row?.[j]);
        out[j] = Number.isFinite(v) ? v : i === j ? 1 : 0;
      }
      return out;
    });
    const safeB = arm.b.map((v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    });

    state.arms.set(arm.name, {
      name: arm.name,
      A: safeA,
      b: safeB,
      pulls: Number.isFinite(arm.pulls) ? Math.max(0, arm.pulls) : 0,
      totalReward: Number.isFinite(arm.totalReward) ? arm.totalReward : 0
    });
  }
  return state;
}
