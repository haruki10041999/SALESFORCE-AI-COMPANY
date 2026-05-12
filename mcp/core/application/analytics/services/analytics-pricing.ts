import { promises as fsPromises } from "fs";
import { resolve } from "path";

export interface PricingBudgetConfig {
  currency: string;
  dailyLimit: number;
  monthlyLimit: number;
}

export async function loadPricingBudgets(outputsDir: string): Promise<PricingBudgetConfig> {
  const pricingPath = resolve(outputsDir, "pricing.json");
  try {
    const raw = await fsPromises.readFile(pricingPath, "utf-8");
    const parsed = JSON.parse(raw) as {
      defaults?: { currency?: string };
      budgets?: {
        daily?: { limit?: number };
        monthly?: { limit?: number };
      };
    };
    return {
      currency: parsed.defaults?.currency ?? "USD",
      dailyLimit: parsed.budgets?.daily?.limit ?? 10000,
      monthlyLimit: parsed.budgets?.monthly?.limit ?? 200000
    };
  } catch {
    return {
      currency: "USD",
      dailyLimit: 10000,
      monthlyLimit: 200000
    };
  }
}
