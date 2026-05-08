import { existsSync, promises as fsPromises, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { estimateTokensApprox } from "../prompt/token-counter.js";
import { appendTextFileAtomic } from "../persistence/unit-of-work.js";

export interface CostLedgerEntry {
  id: string;
  ts: string;
  toolName: string;
  traceId?: string;
  actorId: string;
  tenantId?: string;
  sessionId?: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  usdEstimate: number;
  status: "success" | "error" | "blocked";
  reason?: string;
}

interface BudgetLimit {
  usd?: number;
  totalTokens?: number;
}

export interface CostBudgetConfig {
  version: string;
  currency: string;
  defaultModel: string;
  outputTokenRatio: number;
  limits: {
    session?: BudgetLimit;
    actorPerDay?: BudgetLimit;
    tenantPerDay?: BudgetLimit;
    globalPerDay?: BudgetLimit;
  };
}

export interface CostBudgetCheckInput {
  ts?: string;
  toolName: string;
  traceId?: string;
  actorId: string;
  tenantId?: string;
  sessionId?: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface CostBudgetCheckResult {
  allowed: boolean;
  reason?: string;
  projectedUsd: number;
  projectedTokens: number;
}

const DEFAULT_CONFIG: CostBudgetConfig = {
  version: "1.0",
  currency: "USD",
  defaultModel: "mistral",
  outputTokenRatio: 0.3,
  limits: {
    session: {
      usd: 25,
      totalTokens: 200000
    },
    actorPerDay: {
      usd: 50,
      totalTokens: 400000
    },
    tenantPerDay: {
      usd: 500,
      totalTokens: 4000000
    },
    globalPerDay: {
      usd: 2000,
      totalTokens: 12000000
    }
  }
};

function normalizeNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return value;
}

function normalizeConfig(raw: unknown): CostBudgetConfig {
  if (!raw || typeof raw !== "object") {
    return DEFAULT_CONFIG;
  }
  const r = raw as Record<string, unknown>;
  const limits = (r.limits && typeof r.limits === "object") ? r.limits as Record<string, unknown> : {};

  function normLimit(key: string): BudgetLimit | undefined {
    const value = limits[key];
    if (!value || typeof value !== "object") return undefined;
    const v = value as Record<string, unknown>;
    const usd = normalizeNumber(v.usd);
    const totalTokens = normalizeNumber(v.totalTokens);
    if (usd === undefined && totalTokens === undefined) return undefined;
    return { usd, totalTokens };
  }

  return {
    version: typeof r.version === "string" ? r.version : DEFAULT_CONFIG.version,
    currency: typeof r.currency === "string" ? r.currency : DEFAULT_CONFIG.currency,
    defaultModel: typeof r.defaultModel === "string" ? r.defaultModel : DEFAULT_CONFIG.defaultModel,
    outputTokenRatio: normalizeNumber(r.outputTokenRatio) ?? DEFAULT_CONFIG.outputTokenRatio,
    limits: {
      session: normLimit("session") ?? DEFAULT_CONFIG.limits.session,
      actorPerDay: normLimit("actorPerDay") ?? DEFAULT_CONFIG.limits.actorPerDay,
      tenantPerDay: normLimit("tenantPerDay") ?? DEFAULT_CONFIG.limits.tenantPerDay,
      globalPerDay: normLimit("globalPerDay") ?? DEFAULT_CONFIG.limits.globalPerDay
    }
  };
}

function createId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function dayStartIso(ts: string): string {
  const d = new Date(ts);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function parseLedgerLine(line: string): CostLedgerEntry | null {
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    if (typeof parsed.ts !== "string" || typeof parsed.toolName !== "string" || typeof parsed.actorId !== "string") {
      return null;
    }
    const inputTokens = Number(parsed.inputTokens ?? 0);
    const outputTokens = Number(parsed.outputTokens ?? 0);
    const usdEstimate = Number(parsed.usdEstimate ?? 0);
    const status = parsed.status === "error" || parsed.status === "blocked" ? parsed.status : "success";
    return {
      id: typeof parsed.id === "string" ? parsed.id : createId(),
      ts: parsed.ts,
      toolName: parsed.toolName,
      traceId: typeof parsed.traceId === "string" ? parsed.traceId : undefined,
      actorId: parsed.actorId,
      tenantId: typeof parsed.tenantId === "string" ? parsed.tenantId : undefined,
      sessionId: typeof parsed.sessionId === "string" ? parsed.sessionId : undefined,
      model: typeof parsed.model === "string" ? parsed.model : DEFAULT_CONFIG.defaultModel,
      inputTokens: Math.max(0, Math.floor(Number.isFinite(inputTokens) ? inputTokens : 0)),
      outputTokens: Math.max(0, Math.floor(Number.isFinite(outputTokens) ? outputTokens : 0)),
      usdEstimate: Number.isFinite(usdEstimate) ? usdEstimate : 0,
      status,
      reason: typeof parsed.reason === "string" ? parsed.reason : undefined
    };
  } catch {
    return null;
  }
}

function readRateFromPricing(model: string, outputsDir: string): { input: number; output: number } {
  try {
    const pricingPath = resolve(outputsDir, "pricing.json");
    const raw = JSON.parse(readFileSync(pricingPath, "utf-8")) as Record<string, unknown>;
    const models = asRecord(raw.models);
    const row = asRecord(models[model.toLowerCase()] ?? models.mistral);
    const inputRate = Number(row.inputTokenRate ?? 0.00005);
    const outputRate = Number(row.outputTokenRate ?? 0.00015);
    return {
      input: Number.isFinite(inputRate) ? inputRate : 0.00005,
      output: Number.isFinite(outputRate) ? outputRate : 0.00015
    };
  } catch {
    return { input: 0.00005, output: 0.00015 };
  }
}

function sum(entries: CostLedgerEntry[]): { usd: number; totalTokens: number } {
  let usd = 0;
  let totalTokens = 0;
  for (const e of entries) {
    if (e.status === "blocked") continue;
    usd += e.usdEstimate;
    totalTokens += e.inputTokens + e.outputTokens;
  }
  return { usd, totalTokens };
}

function checkLimit(
  scopeName: string,
  current: { usd: number; totalTokens: number },
  add: { usd: number; totalTokens: number },
  limit?: BudgetLimit
): string | undefined {
  if (!limit) return undefined;
  const nextUsd = current.usd + add.usd;
  const nextTokens = current.totalTokens + add.totalTokens;
  if (typeof limit.usd === "number" && limit.usd >= 0 && nextUsd > limit.usd) {
    return `${scopeName} usd budget exceeded (${nextUsd.toFixed(6)} > ${limit.usd})`;
  }
  if (typeof limit.totalTokens === "number" && limit.totalTokens >= 0 && nextTokens > limit.totalTokens) {
    return `${scopeName} token budget exceeded (${nextTokens} > ${limit.totalTokens})`;
  }
  return undefined;
}

export class CostBudgetManager {
  private readonly outputsDir: string;
  private readonly ledgerFilePath: string;
  private readonly configPath: string;

  constructor(options: { outputsDir: string; ledgerFilePath?: string; configPath?: string }) {
    this.outputsDir = options.outputsDir;
    this.ledgerFilePath = options.ledgerFilePath ?? resolve(options.outputsDir, "audit", "cost-ledger.jsonl");
    this.configPath = options.configPath ?? resolve(process.cwd(), "config", "budgets", "default.yaml");
  }

  public async loadConfig(): Promise<CostBudgetConfig> {
    try {
      const raw = await fsPromises.readFile(this.configPath, "utf-8");
      return normalizeConfig(JSON.parse(raw));
    } catch {
      return DEFAULT_CONFIG;
    }
  }

  public async loadLedger(): Promise<CostLedgerEntry[]> {
    if (!existsSync(this.ledgerFilePath)) {
      return [];
    }
    try {
      const raw = await fsPromises.readFile(this.ledgerFilePath, "utf-8");
      return raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => parseLedgerLine(line))
        .filter((entry): entry is CostLedgerEntry => entry !== null);
    } catch {
      return [];
    }
  }

  public async assertWithin(input: CostBudgetCheckInput): Promise<CostBudgetCheckResult> {
    const ts = input.ts ?? new Date().toISOString();
    const config = await this.loadConfig();
    const entries = await this.loadLedger();

    const usdEstimate = this.estimateUsd(input.model, input.inputTokens, input.outputTokens);
    const add = { usd: usdEstimate, totalTokens: input.inputTokens + input.outputTokens };
    const todayStart = dayStartIso(ts);

    const dayEntries = entries.filter((entry) => entry.ts >= todayStart);
    const actorDay = dayEntries.filter((entry) => entry.actorId === input.actorId);
    const tenantDay = input.tenantId ? dayEntries.filter((entry) => entry.tenantId === input.tenantId) : [];
    const sessionAll = input.sessionId ? entries.filter((entry) => entry.sessionId === input.sessionId) : [];

    const globalStats = sum(dayEntries);
    const actorStats = sum(actorDay);
    const tenantStats = sum(tenantDay);
    const sessionStats = sum(sessionAll);

    const reasons = [
      checkLimit("global/day", globalStats, add, config.limits.globalPerDay),
      checkLimit(`actor/day:${input.actorId}`, actorStats, add, config.limits.actorPerDay),
      input.tenantId ? checkLimit(`tenant/day:${input.tenantId}`, tenantStats, add, config.limits.tenantPerDay) : undefined,
      input.sessionId ? checkLimit(`session:${input.sessionId}`, sessionStats, add, config.limits.session) : undefined
    ].filter((item): item is string => typeof item === "string");

    return {
      allowed: reasons.length === 0,
      reason: reasons[0],
      projectedUsd: globalStats.usd + add.usd,
      projectedTokens: globalStats.totalTokens + add.totalTokens
    };
  }

  public async recordUsage(entry: Omit<CostLedgerEntry, "id">): Promise<CostLedgerEntry> {
    const normalized: CostLedgerEntry = {
      ...entry,
      id: createId(),
      inputTokens: Math.max(0, Math.floor(entry.inputTokens)),
      outputTokens: Math.max(0, Math.floor(entry.outputTokens)),
      usdEstimate: Number.isFinite(entry.usdEstimate) ? entry.usdEstimate : 0
    };

    await fsPromises.mkdir(dirname(this.ledgerFilePath), { recursive: true });
    await appendTextFileAtomic(this.ledgerFilePath, `${JSON.stringify(normalized)}\n`);
    return normalized;
  }

  public estimateUsd(model: string, inputTokens: number, outputTokens: number): number {
    const rate = readRateFromPricing(model, this.outputsDir);
    return inputTokens * rate.input + outputTokens * rate.output;
  }
}

export function estimateTokensForValue(value: unknown): number {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? {});
  return estimateTokensApprox(text);
}

export function buildCostUsageFromInputOutput(params: {
  inputSummary: string;
  outputSummary?: string;
  outputRatio: number;
}): { inputTokens: number; outputTokens: number } {
  const inputTokens = estimateTokensForValue(params.inputSummary);
  const outputTokens = params.outputSummary
    ? estimateTokensForValue(params.outputSummary)
    : Math.ceil(inputTokens * Math.max(0, params.outputRatio));
  return {
    inputTokens,
    outputTokens
  };
}
