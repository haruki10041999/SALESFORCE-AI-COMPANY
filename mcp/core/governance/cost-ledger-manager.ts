/**
 * TASK-01: Cost Ledger Manager
 *
 * ト�Eクン費用を追跡し、以下を実裁E��る！E
 *  1. Per-model cost rates�E�EpenAI、Cohere、Mistral など�E�E
 *  2. Daily budget enforcement
 *  3. Tenant quotas
 *  4. SLA burn accounting
 *  5. PostgreSQL cost_ledger チE�Eブルへの永続化
 *
 * 設定！E
 *  - SF_AI_COST_LEDGER_ENABLED: 有効化フラグ (既宁E true)
 *  - SF_AI_COST_WARNING_THRESHOLD: 警告閾値�E�パーセント、既宁E 80�E�E
 *  - SF_AI_COST_DAILY_LIMIT_USD: 日次予算上限 (既宁E 1000)
 *  - SF_AI_COST_MONTHLY_LIMIT_USD: 月次予算上限 (既宁E 30000)
 */

import { eq, and, gte, lt } from "drizzle-orm";
import type { DbClient } from "../../../db/client.js";
import { costLedgerTable } from "../../../db/schema/cost-ledger.js";
import { createLogger } from "../logging/logger.js";

const logger = createLogger("CostLedgerManager");

export interface ModelPricingRate {
  model: string;
  provider: string;
  inputTokenRate: number;      // USD per 1K input tokens
  outputTokenRate: number;     // USD per 1K output tokens
  currency: string;
  lastUpdated: Date;
}

export interface CostLedgerRecord {
  id: string;
  ts: Date;
  actorId: string;
  tenantId?: string;
  sessionId?: string;
  toolName: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  usdEstimateMicro: number;    // USD in micro units (÷ 1,000,000 for dollars)
  traceId?: string;
  status: "success" | "error" | "blocked";
}

export interface CostBudgetStatus {
  dailySpentUsd: number;
  dailyLimitUsd: number;
  dailyPercentage: number;
  monthlySpentUsd: number;
  monthlyLimitUsd: number;
  monthlyPercentage: number;
  isOverDaily: boolean;
  isOverMonthly: boolean;
  warningThreshold: number;
}

export interface TenantQuotaStatus {
  tenantId: string;
  dailySpentUsd: number;
  dailyLimitUsd: number;
  monthlySpentUsd: number;
  monthlyLimitUsd: number;
  dailyPercentage: number;
  monthlyPercentage: number;
  isOverDaily: boolean;
  isOverMonthly: boolean;
}

/**
 * 標準的なモチE��価格表�E�E024年時点�E�E
 * OpenAI、Cohere、Mistral の実価格
 */
const DEFAULT_PRICING_RATES: Record<string, ModelPricingRate> = {
  // OpenAI Embedding Models
  "text-embedding-3-small": {
    model: "text-embedding-3-small",
    provider: "openai",
    inputTokenRate: 0.00002,      // $0.02 per 1M input tokens
    outputTokenRate: 0.00002,
    currency: "USD",
    lastUpdated: new Date("2024-01-01")
  },
  "text-embedding-3-large": {
    model: "text-embedding-3-large",
    provider: "openai",
    inputTokenRate: 0.00013,       // $0.13 per 1M input tokens
    outputTokenRate: 0.00013,
    currency: "USD",
    lastUpdated: new Date("2024-01-01")
  },
  "text-embedding-ada-002": {
    model: "text-embedding-ada-002",
    provider: "openai",
    inputTokenRate: 0.0001,        // $0.10 per 1M tokens
    outputTokenRate: 0.0001,
    currency: "USD",
    lastUpdated: new Date("2024-01-01")
  },
  "gpt-4-turbo": {
    model: "gpt-4-turbo",
    provider: "openai",
    inputTokenRate: 0.01,          // $10 per 1M input tokens
    outputTokenRate: 0.03,         // $30 per 1M output tokens
    currency: "USD",
    lastUpdated: new Date("2024-01-01")
  },
  "gpt-4": {
    model: "gpt-4",
    provider: "openai",
    inputTokenRate: 0.03,          // $30 per 1M input tokens
    outputTokenRate: 0.06,         // $60 per 1M output tokens
    currency: "USD",
    lastUpdated: new Date("2024-01-01")
  },
  // Cohere Models
  "embed-english-v3.0": {
    model: "embed-english-v3.0",
    provider: "cohere",
    inputTokenRate: 0.0001,        // $0.10 per 1M tokens
    outputTokenRate: 0.0001,
    currency: "USD",
    lastUpdated: new Date("2024-01-01")
  },
  "embed-english-light-v3.0": {
    model: "embed-english-light-v3.0",
    provider: "cohere",
    inputTokenRate: 0.00003,       // $0.03 per 1M tokens
    outputTokenRate: 0.00003,
    currency: "USD",
    lastUpdated: new Date("2024-01-01")
  },
  "command-r-plus": {
    model: "command-r-plus",
    provider: "cohere",
    inputTokenRate: 0.003,         // $3 per 1M input tokens
    outputTokenRate: 0.015,        // $15 per 1M output tokens
    currency: "USD",
    lastUpdated: new Date("2024-01-01")
  },
  // Mistral
  "mistral": {
    model: "mistral",
    provider: "local",
    inputTokenRate: 0.0,           // Local execution, no cost
    outputTokenRate: 0.0,
    currency: "USD",
    lastUpdated: new Date("2024-01-01")
  },
  "mistral-small": {
    model: "mistral-small",
    provider: "mistral-cloud",
    inputTokenRate: 0.00014,       // $0.14 per 1M input tokens
    outputTokenRate: 0.00042,      // $0.42 per 1M output tokens
    currency: "USD",
    lastUpdated: new Date("2024-01-01")
  },
  "mistral-medium": {
    model: "mistral-medium",
    provider: "mistral-cloud",
    inputTokenRate: 0.00270,       // $2.70 per 1M input tokens
    outputTokenRate: 0.00810,      // $8.10 per 1M output tokens
    currency: "USD",
    lastUpdated: new Date("2024-01-01")
  },
  "mistral-large": {
    model: "mistral-large",
    provider: "mistral-cloud",
    inputTokenRate: 0.0081,        // $8.10 per 1M input tokens
    outputTokenRate: 0.0243,       // $24.30 per 1M output tokens
    currency: "USD",
    lastUpdated: new Date("2024-01-01")
  }
};

export class CostLedgerManager {
  private readonly dbClient: DbClient;
  private readonly pricingRates: Map<string, ModelPricingRate>;
  private readonly dailyLimitUsd: number;
  private readonly monthlyLimitUsd: number;
  private readonly warningThreshold: number;

  constructor(dbClient: DbClient, options: {
    dailyLimitUsd?: number;
    monthlyLimitUsd?: number;
    warningThreshold?: number;  // 0-100, percentage
    customRates?: Record<string, ModelPricingRate>;
  } = {}) {
    this.dbClient = dbClient;
    this.dailyLimitUsd = options.dailyLimitUsd ?? 1000;
    this.monthlyLimitUsd = options.monthlyLimitUsd ?? 30000;
    this.warningThreshold = Math.min(100, Math.max(0, options.warningThreshold ?? 80));

    // Load pricing rates
    this.pricingRates = new Map(
      Object.entries({ ...DEFAULT_PRICING_RATES, ...options.customRates })
        .map(([key, rate]) => [key.toLowerCase(), rate])
    );
  }

  /**
   * ト�Eクンコストを計算！ESD�E�E
   */
  calculateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
    const rate = this.getPricingRate(model);
    if (!rate) {
      logger.warn(`Unknown model "${model}", using mistral rates`);
      return 0;
    }

    // Convert rates from per-1M-tokens to per-token
    const inputCost = (inputTokens * rate.inputTokenRate) / 1000;
    const outputCost = (outputTokens * rate.outputTokenRate) / 1000;
    return inputCost + outputCost;
  }

  /**
   * コストを cost_ledger チE�Eブルに記録
   */
  async recordCost(input: {
    toolName: string;
    actorId: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    tenantId?: string;
    sessionId?: string;
    traceId?: string;
    status?: "success" | "error" | "blocked";
  }): Promise<CostLedgerRecord> {
    const costUsd = this.calculateCostUsd(input.model, input.inputTokens, input.outputTokens);
    const costMicro = Math.round(costUsd * 1000000);

    const record: typeof costLedgerTable.$inferInsert = {
      id: this.generateId(),
      ts: new Date(),
      actorId: input.actorId,
      tenantId: input.tenantId,
      sessionId: input.sessionId,
      model: input.model,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      usdEstimateMicro: costMicro,
      toolName: input.toolName,
      traceId: input.traceId,
      status: input.status ?? "success"
    };

    const result = await this.dbClient.db
      .insert(costLedgerTable)
      .values(record)
      .returning();

    return {
      id: result[0].id,
      ts: result[0].ts,
      actorId: result[0].actorId,
      tenantId: result[0].tenantId ?? undefined,
      sessionId: result[0].sessionId ?? undefined,
      toolName: result[0].toolName,
      model: result[0].model,
      inputTokens: result[0].inputTokens,
      outputTokens: result[0].outputTokens,
      usdEstimateMicro: result[0].usdEstimateMicro,
      traceId: result[0].traceId ?? undefined,
      status: result[0].status as "success" | "error" | "blocked"
    };
  }

  /**
   * グローバル予算スチE�Eタスを取征E
   */
  async getGlobalBudgetStatus(): Promise<CostBudgetStatus> {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const dailyRecords = await this.dbClient.db
      .select()
      .from(costLedgerTable)
      .where(and(
        gte(costLedgerTable.ts, todayStart),
        lt(costLedgerTable.ts, new Date(todayStart.getTime() + 86400000))
      ));

    const monthlyRecords = await this.dbClient.db
      .select()
      .from(costLedgerTable)
      .where(and(
        gte(costLedgerTable.ts, monthStart),
        lt(costLedgerTable.ts, new Date(monthStart.getTime() + 31 * 86400000))
      ));

    const dailySpent = dailyRecords.reduce(
      (sum: number, record: (typeof dailyRecords)[number]) => sum + (record.usdEstimateMicro / 1000000),
      0
    );
    const monthlySpent = monthlyRecords.reduce(
      (sum: number, record: (typeof monthlyRecords)[number]) => sum + (record.usdEstimateMicro / 1000000),
      0
    );

    const dailyPercentage = (dailySpent / this.dailyLimitUsd) * 100;
    const monthlyPercentage = (monthlySpent / this.monthlyLimitUsd) * 100;

    return {
      dailySpentUsd: dailySpent,
      dailyLimitUsd: this.dailyLimitUsd,
      dailyPercentage,
      monthlySpentUsd: monthlySpent,
      monthlyLimitUsd: this.monthlyLimitUsd,
      monthlyPercentage,
      isOverDaily: dailySpent > this.dailyLimitUsd,
      isOverMonthly: monthlySpent > this.monthlyLimitUsd,
      warningThreshold: this.warningThreshold
    };
  }

  /**
   * チE��ント別の予算スチE�Eタスを取征E
   */
  async getTenantQuotaStatus(tenantId: string, dailyLimitUsd = 500, monthlyLimitUsd = 15000): Promise<TenantQuotaStatus> {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const dailyRecords = await this.dbClient.db
      .select()
      .from(costLedgerTable)
      .where(and(
        eq(costLedgerTable.tenantId, tenantId),
        gte(costLedgerTable.ts, todayStart),
        lt(costLedgerTable.ts, new Date(todayStart.getTime() + 86400000))
      ));

    const monthlyRecords = await this.dbClient.db
      .select()
      .from(costLedgerTable)
      .where(and(
        eq(costLedgerTable.tenantId, tenantId),
        gte(costLedgerTable.ts, monthStart),
        lt(costLedgerTable.ts, new Date(monthStart.getTime() + 31 * 86400000))
      ));

    const dailySpent = dailyRecords.reduce(
      (sum: number, record: (typeof dailyRecords)[number]) => sum + (record.usdEstimateMicro / 1000000),
      0
    );
    const monthlySpent = monthlyRecords.reduce(
      (sum: number, record: (typeof monthlyRecords)[number]) => sum + (record.usdEstimateMicro / 1000000),
      0
    );

    const dailyPercentage = (dailySpent / dailyLimitUsd) * 100;
    const monthlyPercentage = (monthlySpent / monthlyLimitUsd) * 100;

    return {
      tenantId,
      dailySpentUsd: dailySpent,
      dailyLimitUsd,
      monthlySpentUsd: monthlySpent,
      monthlyLimitUsd,
      dailyPercentage,
      monthlyPercentage,
      isOverDaily: dailySpent > dailyLimitUsd,
      isOverMonthly: monthlySpent > monthlyLimitUsd
    };
  }

  /**
   * SLA burn rate を計算！E日あたり�Eコスト消費速度�E�E
   * 侁E 30日予算で7日目に50%消費 = burn rate 2.1x
   */
  async calculateSlaBurnRate(): Promise<number> {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const dayOfMonth = now.getDate();

    const records = await this.dbClient.db
      .select()
      .from(costLedgerTable)
      .where(gte(costLedgerTable.ts, monthStart));

    const totalSpent = records.reduce(
      (sum: number, record: (typeof records)[number]) => sum + (record.usdEstimateMicro / 1000000),
      0
    );
    const expectedDaily = this.monthlyLimitUsd / 30;
    const expectedSpent = expectedDaily * dayOfMonth;

    if (expectedSpent === 0) return 0;
    return totalSpent / expectedSpent;
  }

  /**
   * 支出傾向を取得（直迁E日間！E
   */
  async getCostTrendLast7Days(): Promise<Array<{ date: string; costUsd: number }>> {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000);

    const records = await this.dbClient.db
      .select()
      .from(costLedgerTable)
      .where(gte(costLedgerTable.ts, sevenDaysAgo));

    const grouped = new Map<string, number>();
    for (const record of records) {
      const date = record.ts.toISOString().split("T")[0];
      const current = grouped.get(date) ?? 0;
      grouped.set(date, current + (record.usdEstimateMicro / 1000000));
    }

    return Array.from(grouped.entries())
      .map(([date, costUsd]) => ({ date, costUsd }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * モチE��別コスト�E訳を取征E
   */
  async getCostByModel(startDate?: Date, endDate?: Date): Promise<Record<string, number>> {
    const start = startDate ?? new Date(Date.now() - 30 * 86400000);
    const end = endDate ?? new Date();

    const records = await this.dbClient.db
      .select()
      .from(costLedgerTable)
      .where(and(
        gte(costLedgerTable.ts, start),
        lt(costLedgerTable.ts, end)
      ));

    const grouped = new Map<string, number>();
    for (const record of records) {
      const current = grouped.get(record.model) ?? 0;
      grouped.set(record.model, current + (record.usdEstimateMicro / 1000000));
    }

    return Object.fromEntries(grouped);
  }

  /**
   * Actor 別コスト�E訳を取征E
   */
  async getCostByActor(startDate?: Date, endDate?: Date): Promise<Record<string, number>> {
    const start = startDate ?? new Date(Date.now() - 30 * 86400000);
    const end = endDate ?? new Date();

    const records = await this.dbClient.db
      .select()
      .from(costLedgerTable)
      .where(and(
        gte(costLedgerTable.ts, start),
        lt(costLedgerTable.ts, end)
      ));

    const grouped = new Map<string, number>();
    for (const record of records) {
      const current = grouped.get(record.actorId) ?? 0;
      grouped.set(record.actorId, current + (record.usdEstimateMicro / 1000000));
    }

    return Object.fromEntries(grouped);
  }

  /**
   * モチE��価格表を取征E
   */
  getPricingRate(model: string): ModelPricingRate | undefined {
    return this.pricingRates.get(model.toLowerCase());
  }

  /**
   * 全モチE��価格表を取征E
   */
  getAllPricingRates(): ModelPricingRate[] {
    return Array.from(this.pricingRates.values());
  }

  /**
   * ID を生戁E
   */
  private generateId(): string {
    return `cost_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }
}
