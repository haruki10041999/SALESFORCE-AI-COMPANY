/**
 * Model Registry (TASK-045)
 *
 * 同名モデルの複数バージョンを「production」「shadow」として併走させ、
 * shadow が production を一定回数上回ったら自動 promote、不調なら rollback。
 *
 * 設計:
 * - generic predictor: `(input) => output` 形式の任意関数
 * - 比較は呼び出し側が「どちらが良かったか」を記録 (recordOutcome)
 * - 評価指標: shadowWins / total + signed delta
 * - 永続化: snapshot を JSON 化／復元する純粋関数を提供 (I/O は呼び出し側)
 *
 * 想定ユースケース:
 *   - query-skill-v1 を production、v2 を shadow として併走
 *   - 一定数のリアル input で v2 の方が success rate が高ければ promote
 */

export interface ModelVersion<TInput, TOutput> {
  name: string;
  version: string;
  predict: (input: TInput) => TOutput;
  registeredAt: string;
}

export interface ModelEvaluationStats {
  shadowVersion: string;
  productionVersion: string;
  total: number;
  shadowWins: number;
  productionWins: number;
  ties: number;
  /** (shadowWins - productionWins) / total */
  signedDelta: number;
  shadowWinRate: number;
}

export type ModelOutcome = "shadow" | "production" | "tie";

export interface ModelRegistryEntry<TInput, TOutput> {
  name: string;
  productionVersion: string;
  versions: Map<string, ModelVersion<TInput, TOutput>>;
  shadowVersions: Set<string>;
  /** バージョン履歴 (新→旧)。rollback に使用 */
  history: string[];
  evaluations: Map<string, ModelEvaluationStats>;
}

export interface ModelRegistrySnapshot {
  models: Array<{
    name: string;
    productionVersion: string;
    versionList: string[];
    shadowVersions: string[];
    history: string[];
    evaluations: ModelEvaluationStats[];
  }>;
}

/**
 * 内部状態をクラスに抱えず、明示的に Registry 構造を渡し回す純関数 API。
 */
export type ModelRegistry = Map<string, ModelRegistryEntry<unknown, unknown>>;

export function createModelRegistry(): ModelRegistry {
  return new Map();
}

export function registerModelVersion<TInput, TOutput>(
  registry: ModelRegistry,
  modelVersion: Omit<ModelVersion<TInput, TOutput>, "registeredAt">
): void {
  if (!modelVersion.name || !modelVersion.version) {
    throw new Error("name and version are required");
  }
  let entry = registry.get(modelVersion.name) as
    | ModelRegistryEntry<TInput, TOutput>
    | undefined;
  if (!entry) {
    entry = {
      name: modelVersion.name,
      productionVersion: modelVersion.version,
      versions: new Map(),
      shadowVersions: new Set(),
      history: [modelVersion.version],
      evaluations: new Map()
    };
    registry.set(modelVersion.name, entry as ModelRegistryEntry<unknown, unknown>);
  } else if (entry.versions.has(modelVersion.version)) {
    throw new Error(`version already registered: ${modelVersion.name}@${modelVersion.version}`);
  }

  entry.versions.set(modelVersion.version, {
    ...modelVersion,
    registeredAt: new Date().toISOString()
  });
}

export function setShadowVersion(
  registry: ModelRegistry,
  modelName: string,
  shadowVersion: string
): void {
  const entry = registry.get(modelName);
  if (!entry) throw new Error(`unknown model: ${modelName}`);
  if (!entry.versions.has(shadowVersion)) {
    throw new Error(`unknown shadow version: ${modelName}@${shadowVersion}`);
  }
  if (shadowVersion === entry.productionVersion) {
    throw new Error("shadow version must differ from production");
  }
  entry.shadowVersions.add(shadowVersion);
  if (!entry.evaluations.has(shadowVersion)) {
    entry.evaluations.set(shadowVersion, {
      shadowVersion,
      productionVersion: entry.productionVersion,
      total: 0,
      shadowWins: 0,
      productionWins: 0,
      ties: 0,
      signedDelta: 0,
      shadowWinRate: 0
    });
  }
}

export function clearShadowVersion(
  registry: ModelRegistry,
  modelName: string,
  shadowVersion: string
): void {
  const entry = registry.get(modelName);
  if (!entry) return;
  entry.shadowVersions.delete(shadowVersion);
  entry.evaluations.delete(shadowVersion);
}

/**
 * production と全 shadow を併走実行する。production の出力を返し、
 * shadow 出力は `shadowOutputs[version]` に格納される。
 */
export function predictWithShadows<TInput, TOutput>(
  registry: ModelRegistry,
  modelName: string,
  input: TInput
): { production: TOutput; productionVersion: string; shadowOutputs: Record<string, TOutput> } {
  const entry = registry.get(modelName) as
    | ModelRegistryEntry<TInput, TOutput>
    | undefined;
  if (!entry) throw new Error(`unknown model: ${modelName}`);

  const prodModel = entry.versions.get(entry.productionVersion);
  if (!prodModel) {
    throw new Error(`production version missing: ${modelName}@${entry.productionVersion}`);
  }
  const production = prodModel.predict(input);

  const shadowOutputs: Record<string, TOutput> = {};
  for (const shadowVersion of entry.shadowVersions) {
    const shadow = entry.versions.get(shadowVersion);
    if (!shadow) continue;
    try {
      shadowOutputs[shadowVersion] = shadow.predict(input);
    } catch {
      // shadow の失敗は production を阻害しない
    }
  }

  return { production, productionVersion: entry.productionVersion, shadowOutputs };
}

/**
 * 併走結果に対する真の正解 (どちらが良かったか) を記録する。
 */
export function recordOutcome(
  registry: ModelRegistry,
  modelName: string,
  shadowVersion: string,
  outcome: ModelOutcome
): ModelEvaluationStats {
  const entry = registry.get(modelName);
  if (!entry) throw new Error(`unknown model: ${modelName}`);
  const stats = entry.evaluations.get(shadowVersion);
  if (!stats) {
    throw new Error(`shadow not registered for evaluation: ${modelName}@${shadowVersion}`);
  }
  stats.total += 1;
  if (outcome === "shadow") stats.shadowWins += 1;
  else if (outcome === "production") stats.productionWins += 1;
  else stats.ties += 1;
  stats.signedDelta = (stats.shadowWins - stats.productionWins) / stats.total;
  stats.shadowWinRate = stats.total === 0 ? 0 : stats.shadowWins / stats.total;
  return stats;
}

export interface PromotionPolicy {
  /** 評価開始からこれ以上のサンプルが集まるまで promote しない */
  minSamples: number;
  /** shadow の win rate がこの値を超えたら promote */
  minShadowWinRate: number;
  /** signedDelta がこの値を超えたら promote */
  minSignedDelta: number;
}

export const DEFAULT_PROMOTION_POLICY: PromotionPolicy = {
  minSamples: 30,
  minShadowWinRate: 0.55,
  minSignedDelta: 0.1
};

/**
 * shadow が policy を満たしていれば promote 候補として返す。
 */
export function evaluatePromotion(
  registry: ModelRegistry,
  modelName: string,
  policy: PromotionPolicy = DEFAULT_PROMOTION_POLICY
): { ready: boolean; candidate?: string; stats?: ModelEvaluationStats; reason: string } {
  const entry = registry.get(modelName);
  if (!entry) return { ready: false, reason: "unknown model" };
  let best: ModelEvaluationStats | null = null;
  for (const stats of entry.evaluations.values()) {
    if (stats.total < policy.minSamples) continue;
    if (stats.shadowWinRate < policy.minShadowWinRate) continue;
    if (stats.signedDelta < policy.minSignedDelta) continue;
    if (!best || stats.signedDelta > best.signedDelta) {
      best = stats;
    }
  }
  if (!best) return { ready: false, reason: "no shadow met policy" };
  return { ready: true, candidate: best.shadowVersion, stats: best, reason: "policy satisfied" };
}

/**
 * shadow を production に昇格する。元の production は履歴に残し、
 * shadow から外す（不要になったため）。
 */
export function promoteShadow(
  registry: ModelRegistry,
  modelName: string,
  shadowVersion: string
): { previous: string; current: string } {
  const entry = registry.get(modelName);
  if (!entry) throw new Error(`unknown model: ${modelName}`);
  if (!entry.versions.has(shadowVersion)) {
    throw new Error(`unknown shadow version: ${modelName}@${shadowVersion}`);
  }
  if (!entry.shadowVersions.has(shadowVersion)) {
    throw new Error(`version is not currently shadow: ${modelName}@${shadowVersion}`);
  }
  const previous = entry.productionVersion;
  entry.productionVersion = shadowVersion;
  entry.shadowVersions.delete(shadowVersion);
  entry.evaluations.delete(shadowVersion);
  if (entry.history[0] !== shadowVersion) {
    entry.history.unshift(shadowVersion);
  }
  return { previous, current: shadowVersion };
}

/**
 * 直近の履歴から 1 個前の production に戻す。
 */
export function rollback(
  registry: ModelRegistry,
  modelName: string
): { from: string; to: string } {
  const entry = registry.get(modelName);
  if (!entry) throw new Error(`unknown model: ${modelName}`);
  if (entry.history.length < 2) {
    throw new Error("no previous version available for rollback");
  }
  const from = entry.productionVersion;
  // history[0] は現在の production
  // history[1] が直前の version
  const to = entry.history[1];
  if (!entry.versions.has(to)) {
    throw new Error(`previous version missing from registry: ${to}`);
  }
  entry.productionVersion = to;
  // rollback 後は from を履歴から外す (再 rollback でさらに古いバージョンへ戻れる)
  entry.history = entry.history.filter((v) => v !== from && v !== to);
  entry.history.unshift(to);
  return { from, to };
}

/**
 * registry を JSON snapshot に直列化する (predict 関数は失われる)。
 */
export function toSnapshot(registry: ModelRegistry): ModelRegistrySnapshot {
  const models: ModelRegistrySnapshot["models"] = [];
  for (const entry of registry.values()) {
    models.push({
      name: entry.name,
      productionVersion: entry.productionVersion,
      versionList: [...entry.versions.keys()],
      shadowVersions: [...entry.shadowVersions],
      history: [...entry.history],
      evaluations: [...entry.evaluations.values()].map((e) => ({ ...e }))
    });
  }
  return { models };
}
