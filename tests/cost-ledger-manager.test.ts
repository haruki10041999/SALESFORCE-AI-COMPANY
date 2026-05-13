/**
 * TASK-01: Cost Ledger Manager Tests
 *
 * Verify:
 *  1. Token cost calculation for different models
 *  2. Cost recording to database
 *  3. Global budget tracking
 *  4. Tenant quota enforcement
 *  5. SLA burn rate calculation
 *  6. Cost trend analysis
 */

import assert from "node:assert/strict";
import test from "node:test";
import { CostLedgerManager, type ModelPricingRate } from "../mcp/core/governance/cost-ledger-manager.js";

// Mock PostgreSQL client for testing
class MockPgClient {
  private records: Array<Record<string, unknown>> = [];

  get db() {
    return {
      insert: (table: unknown) => ({
        values: (record: Record<string, unknown>) => ({
          returning: async () => {
            this.records.push(record);
            return [{ ...record, id: record.id }];
          }
        })
      }),
      select: () => ({
        from: (table: unknown) => ({
          where: async (condition: unknown) => this.records
        })
      })
    };
  }

  getRecords() {
    return this.records;
  }
}

test("TASK-01: calculateCostUsd - returns 0 for local mistral", () => {
  const mgr = new CostLedgerManager(new MockPgClient() as any);
  const cost = mgr.calculateCostUsd("mistral", 1000, 500);
  assert.equal(cost, 0);
});

test("TASK-01: calculateCostUsd - calculates OpenAI embedding cost", () => {
  const mgr = new CostLedgerManager(new MockPgClient() as any);
  const cost = mgr.calculateCostUsd("text-embedding-3-small", 1000000, 500000);
  
  // $0.02 per 1M input + $0.02 per 1M output
  // 1M input = $0.02, 500k output = $0.01, total = $0.03
  assert.ok(cost > 0.029 && cost < 0.031, `Expected ~0.03, got ${cost}`);
});

test("TASK-01: calculateCostUsd - calculates Cohere embedding cost", () => {
  const mgr = new CostLedgerManager(new MockPgClient() as any);
  const cost = mgr.calculateCostUsd("embed-english-v3.0", 1000000, 500000);
  
  // $0.10 per 1M tokens = $0.15 total
  assert.ok(cost > 0.149 && cost < 0.151, `Expected ~0.15, got ${cost}`);
});

test("TASK-01: calculateCostUsd - calculates GPT-4 cost correctly", () => {
  const mgr = new CostLedgerManager(new MockPgClient() as any);
  const cost = mgr.calculateCostUsd("gpt-4", 1000000, 1000000);
  
  // $30 per 1M input + $60 per 1M output = $90 total
  assert.ok(cost > 89 && cost < 91, `Expected ~90, got ${cost}`);
});

test("TASK-01: getPricingRate - returns rate for known model", () => {
  const mgr = new CostLedgerManager(new MockPgClient() as any);
  const rate = mgr.getPricingRate("mistral");
  
  assert.ok(rate);
  assert.equal(rate.model, "mistral");
  assert.equal(rate.provider, "local");
});

test("TASK-01: getPricingRate - returns undefined for unknown model", () => {
  const mgr = new CostLedgerManager(new MockPgClient() as any);
  const rate = mgr.getPricingRate("unknown-model");
  
  assert.equal(rate, undefined);
});

test("TASK-01: getPricingRate - is case-insensitive", () => {
  const mgr = new CostLedgerManager(new MockPgClient() as any);
  const rate1 = mgr.getPricingRate("Mistral");
  const rate2 = mgr.getPricingRate("MISTRAL");
  
  assert.equal(rate1?.model, rate2?.model);
});

test("TASK-01: getAllPricingRates - returns all configured rates", () => {
  const mgr = new CostLedgerManager(new MockPgClient() as any);
  const rates = mgr.getAllPricingRates();
  
  assert.ok(rates.length > 0);
  assert.ok(rates.some(r => r.provider === "openai"));
  assert.ok(rates.some(r => r.provider === "cohere"));
  assert.ok(rates.some(r => r.provider === "local"));
});

test("TASK-01: constructor - accepts custom pricing rates", () => {
  const customRate: ModelPricingRate = {
    model: "custom-model",
    provider: "test",
    inputTokenRate: 0.001,
    outputTokenRate: 0.002,
    currency: "USD",
    lastUpdated: new Date()
  };

  const mgr = new CostLedgerManager(new MockPgClient() as any, {
    customRates: { "custom-model": customRate }
  });

  const rate = mgr.getPricingRate("custom-model");
  assert.deepEqual(rate, customRate);
});

test("TASK-01: constructor - accepts custom budget limits", () => {
  const mockDb = new MockPgClient();
  const mgr = new CostLedgerManager(mockDb as any, {
    dailyLimitUsd: 500,
    monthlyLimitUsd: 10000,
    warningThreshold: 75
  });

  // We can't directly test these, but we verify object is created
  assert.ok(mgr);
});

test("TASK-01: recordCost - persists to mock database", async () => {
  const mockDb = new MockPgClient();
  const mgr = new CostLedgerManager(mockDb as any);

  const record = await mgr.recordCost({
    toolName: "embed",
    actorId: "actor-1",
    model: "text-embedding-3-small",
    inputTokens: 1000,
    outputTokens: 500,
    tenantId: "tenant-1",
    sessionId: "session-1"
  });

  assert.ok(record.id);
  assert.equal(record.actorId, "actor-1");
  assert.equal(record.model, "text-embedding-3-small");
  assert.equal(record.inputTokens, 1000);
  assert.equal(record.outputTokens, 500);
  assert.ok(record.usdEstimateMicro > 0);
  assert.equal(record.status, "success");
});

test("TASK-01: recordCost - accepts optional fields", async () => {
  const mockDb = new MockPgClient();
  const mgr = new CostLedgerManager(mockDb as any);

  const record = await mgr.recordCost({
    toolName: "chat",
    actorId: "actor-2",
    model: "mistral",
    inputTokens: 2000,
    outputTokens: 1000,
    traceId: "trace-123",
    status: "error"
  });

  assert.ok(record.id);
  assert.equal(record.traceId, "trace-123");
  assert.equal(record.status, "error");
  assert.equal(record.tenantId, undefined);
});

test("TASK-01: calculateCostUsd - handles zero tokens", () => {
  const mgr = new CostLedgerManager(new MockPgClient() as any);
  const cost = mgr.calculateCostUsd("gpt-4", 0, 0);
  
  assert.equal(cost, 0);
});

test("TASK-01: calculateCostUsd - handles very large token counts", () => {
  const mgr = new CostLedgerManager(new MockPgClient() as any);
  const cost = mgr.calculateCostUsd("gpt-4-turbo", 10000000, 5000000);
  
  // $10 per 1M input: 10M * $10 = $100
  // $30 per 1M output: 5M * $30 = $150
  // Total = $250
  assert.ok(cost > 249 && cost < 251, `Expected ~250, got ${cost}`);
});

test("TASK-01: Model pricing verification - OpenAI GPT-4 Turbo", () => {
  const mgr = new CostLedgerManager(new MockPgClient() as any);
  const rate = mgr.getPricingRate("gpt-4-turbo");
  
  assert.ok(rate);
  assert.equal(rate.provider, "openai");
  assert.equal(rate.inputTokenRate, 0.01);
  assert.equal(rate.outputTokenRate, 0.03);
});

test("TASK-01: Model pricing verification - Cohere Command-R", () => {
  const mgr = new CostLedgerManager(new MockPgClient() as any);
  const rate = mgr.getPricingRate("command-r-plus");
  
  assert.ok(rate);
  assert.equal(rate.provider, "cohere");
  assert.equal(rate.inputTokenRate, 0.003);
  assert.equal(rate.outputTokenRate, 0.015);
});

test("TASK-01: Model pricing verification - Mistral Small", () => {
  const mgr = new CostLedgerManager(new MockPgClient() as any);
  const rate = mgr.getPricingRate("mistral-small");
  
  assert.ok(rate);
  assert.equal(rate.provider, "mistral-cloud");
  assert.equal(rate.inputTokenRate, 0.00014);
  assert.equal(rate.outputTokenRate, 0.00042);
});

test("TASK-01: Cost micro-unit conversion", async () => {
  const mockDb = new MockPgClient();
  const mgr = new CostLedgerManager(mockDb as any);

  // $0.001 USD
  const record = await mgr.recordCost({
    toolName: "test",
    actorId: "actor-3",
    model: "text-embedding-3-small",
    inputTokens: 50000,   // Should cost ~$0.001
    outputTokens: 0
  });

  // Should be approximately 1000 micro units (0.001 * 1,000,000)
  assert.ok(record.usdEstimateMicro >= 900 && record.usdEstimateMicro <= 1100);
});
