/**
 * T-10: Bulkhead（同時実行数制限）
 *
 * プロバイダ別に同時実行数の上限を設け、
 * ある依存先の混雑が他の処理パスを巻き込まないようにする。
 *
 * p-limit を内部で使う（既存 dependency）。
 */

export interface BulkheadOptions {
  /** 同時実行の上限数 */
  concurrency: number;
  /** キューに積める最大ペンディング数（超えた場合は即時拒否）。省略時は無制限 */
  maxQueue?: number;
}

export class BulkheadRejectedError extends Error {
  public constructor(name: string) {
    super(`Bulkhead rejected: provider='${name}' – queue is full`);
    this.name = "BulkheadRejectedError";
  }
}

export class Bulkhead {
  public readonly name: string;
  private readonly concurrency: number;
  private readonly maxQueue: number;
  private running = 0;
  private queue: Array<() => void> = [];

  public constructor(name: string, options: BulkheadOptions) {
    this.name = name;
    this.concurrency = Math.max(1, options.concurrency);
    this.maxQueue = options.maxQueue ?? Number.POSITIVE_INFINITY;
  }

  /** 現在実行中の件数 */
  public get activeCount(): number {
    return this.running;
  }

  /** キュー待ち件数 */
  public get pendingCount(): number {
    return this.queue.length;
  }

  /**
   * fn を bulkhead 経由で実行する。
   * concurrency 超過時はキューに積む。maxQueue を超えた場合は BulkheadRejectedError を throw。
   */
  public async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.running >= this.concurrency) {
      if (this.queue.length >= this.maxQueue) {
        throw new BulkheadRejectedError(this.name);
      }
      // キュー待ち
      await new Promise<void>((resolve) => {
        this.queue.push(resolve);
      });
    }

    this.running += 1;
    try {
      return await fn();
    } finally {
      this.running -= 1;
      const next = this.queue.shift();
      if (next) {
        next();
      }
    }
  }
}

/**
 * プロバイダ名 → Bulkhead のレジストリ。
 */
export class BulkheadRegistry {
  private readonly bulkheads = new Map<string, Bulkhead>();

  public get(name: string, options: BulkheadOptions): Bulkhead {
    if (!this.bulkheads.has(name)) {
      this.bulkheads.set(name, new Bulkhead(name, options));
    }
    return this.bulkheads.get(name)!;
  }

  public getStats(): Record<string, { active: number; pending: number }> {
    const result: Record<string, { active: number; pending: number }> = {};
    for (const [name, bh] of this.bulkheads) {
      result[name] = { active: bh.activeCount, pending: bh.pendingCount };
    }
    return result;
  }
}

/** シングルトンレジストリ */
export const bulkheadRegistry = new BulkheadRegistry();

// ── デフォルト設定 ────────────────────────────────────────────────────────────

/** pgvector / Postgres 用 bulkhead: 同時 8 件まで */
export const DEFAULT_PGVECTOR_CONCURRENCY = 8;
/** Ollama / LLM 用 bulkhead: 同時 3 件まで */
export const DEFAULT_OLLAMA_CONCURRENCY = 3;
/** 外部 HTTP (LangSmith など) 用 bulkhead: 同時 5 件まで */
export const DEFAULT_EXTERNAL_HTTP_CONCURRENCY = 5;
