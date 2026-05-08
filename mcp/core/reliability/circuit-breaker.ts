/**
 * T-10: Circuit Breaker
 *
 * closed → open → half-open の 3 ステート状態機械。
 * - closed:    通常動作。失敗率が threshold を超えると open へ遷移。
 * - open:      呼び出しを即時拒否（依存先回復待ち）。cooldownMs 後に half-open へ。
 * - half-open: 1 件だけ試行。成功なら closed、失敗なら open に戻る。
 *
 * Prometheus gauge circuit_state{provider} を emit する（任意）。
 */

import { EventEmitter } from "node:events";

export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreakerOptions {
  /** プロバイダ名（ログ・メトリクス用） */
  name: string;
  /** 失敗率 (0–1)。window 内でこれを超えると open になる */
  failureRateThreshold?: number;
  /** 評価ウィンドウ内の最小呼び出し数（これ以下では open にしない） */
  minCallsInWindow?: number;
  /** open → half-open へ遷移するまでの ms */
  cooldownMs?: number;
  /** 評価ウィンドウサイズ（直近 N 件） */
  windowSize?: number;
  /** half-open で連続成功必要数 */
  halfOpenSuccessThreshold?: number;
}

export class CircuitBreakerOpenError extends Error {
  public readonly provider: string;
  public constructor(provider: string) {
    super(`Circuit breaker open: provider='${provider}'`);
    this.name = "CircuitBreakerOpenError";
    this.provider = provider;
  }
}

interface CallRecord {
  success: boolean;
  at: number;
}

export class CircuitBreaker extends EventEmitter {
  public readonly name: string;
  private readonly failureRateThreshold: number;
  private readonly minCallsInWindow: number;
  private readonly cooldownMs: number;
  private readonly windowSize: number;
  private readonly halfOpenSuccessThreshold: number;

  private state: CircuitState = "closed";
  private window: CallRecord[] = [];
  private openedAt: number | null = null;
  private halfOpenSuccesses = 0;

  public constructor(options: CircuitBreakerOptions) {
    super();
    this.name = options.name;
    this.failureRateThreshold = options.failureRateThreshold ?? 0.5;
    this.minCallsInWindow = options.minCallsInWindow ?? 5;
    this.cooldownMs = options.cooldownMs ?? 30_000;
    this.windowSize = options.windowSize ?? 20;
    this.halfOpenSuccessThreshold = options.halfOpenSuccessThreshold ?? 1;
  }

  /** 現在の状態を返す */
  public get currentState(): CircuitState {
    this.maybeTransitionToHalfOpen();
    return this.state;
  }

  /**
   * 保護したい呼び出しを fn として渡す。
   * open 中は CircuitBreakerOpenError を throw する。
   */
  public async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.maybeTransitionToHalfOpen();

    if (this.state === "open") {
      throw new CircuitBreakerOpenError(this.name);
    }

    // half-open 中は 1 件だけ通す
    if (this.state === "half-open") {
      try {
        const result = await fn();
        this.recordSuccess();
        return result;
      } catch (err) {
        this.recordFailure();
        throw err;
      }
    }

    // closed
    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (err) {
      this.recordFailure();
      throw err;
    }
  }

  /** 現在のウィンドウ内の失敗率（0–1）を返す */
  public get failureRate(): number {
    if (this.window.length === 0) return 0;
    const failures = this.window.filter((r) => !r.success).length;
    return failures / this.window.length;
  }

  /** Circuit Breaker をリセットして closed に戻す */
  public reset(): void {
    this.window = [];
    this.openedAt = null;
    this.halfOpenSuccesses = 0;
    this.transitionTo("closed");
  }

  // ── private ──────────────────────────────────────────────────────────────

  private recordSuccess(): void {
    this.push({ success: true, at: Date.now() });
    if (this.state === "half-open") {
      this.halfOpenSuccesses += 1;
      if (this.halfOpenSuccesses >= this.halfOpenSuccessThreshold) {
        this.transitionTo("closed");
      }
    }
  }

  private recordFailure(): void {
    this.push({ success: false, at: Date.now() });
    if (this.state === "half-open") {
      this.transitionTo("open");
      return;
    }
    if (this.state === "closed") {
      this.evaluateWindow();
    }
  }

  private push(record: CallRecord): void {
    this.window.push(record);
    if (this.window.length > this.windowSize) {
      this.window.shift();
    }
  }

  private evaluateWindow(): void {
    if (this.window.length < this.minCallsInWindow) return;
    if (this.failureRate >= this.failureRateThreshold) {
      this.transitionTo("open");
    }
  }

  private maybeTransitionToHalfOpen(): void {
    if (this.state === "open" && this.openedAt !== null) {
      if (Date.now() - this.openedAt >= this.cooldownMs) {
        this.transitionTo("half-open");
      }
    }
  }

  private transitionTo(next: CircuitState): void {
    if (this.state === next) return;
    const prev = this.state;
    this.state = next;
    if (next === "open") {
      this.openedAt = Date.now();
    } else if (next === "closed") {
      this.window = [];
      this.openedAt = null;
      this.halfOpenSuccesses = 0;
    } else if (next === "half-open") {
      this.halfOpenSuccesses = 0;
    }
    this.emit("stateChange", { prev, next, name: this.name });
  }
}

/**
 * プロバイダ名 → CircuitBreaker のレジストリ。
 * アプリ全体で同一インスタンスを共有する。
 */
export class CircuitBreakerRegistry {
  private readonly breakers = new Map<string, CircuitBreaker>();

  public get(name: string, options?: Omit<CircuitBreakerOptions, "name">): CircuitBreaker {
    if (!this.breakers.has(name)) {
      this.breakers.set(name, new CircuitBreaker({ name, ...options }));
    }
    return this.breakers.get(name)!;
  }

  public getState(): Record<string, CircuitState> {
    const result: Record<string, CircuitState> = {};
    for (const [name, cb] of this.breakers) {
      result[name] = cb.currentState;
    }
    return result;
  }

  public resetAll(): void {
    for (const cb of this.breakers.values()) {
      cb.reset();
    }
  }
}

/** シングルトンレジストリ */
export const circuitBreakerRegistry = new CircuitBreakerRegistry();
