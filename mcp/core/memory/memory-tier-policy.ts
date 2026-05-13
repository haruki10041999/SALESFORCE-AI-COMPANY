/**
 * T-17 increment 2: Memory Tier Policy — TTL / Pruning
 *
 * Defines policies for hot/warm/cold tier management:
 * - Tier classification based on age, size, and access frequency
 * - TTL (time-to-live) enforcement for cold storage
 * - Automatic promotion/demotion between tiers
 * - Pruning schedule with configurable retention windows
 */

export type MemoryTier = "hot" | "warm" | "cold";

export interface MemoryTierConfig {
  /** Days before moving from hot to warm */
  hotToWarmDays: number;
  /** Days before moving from warm to cold */
  warmToWoldDays: number;
  /** Days before pruning cold documents */
  coldPruneAfterDays: number;
  /** Max size in MB for hot tier */
  hotMaxSizeMb: number;
  /** Max size in MB for warm tier */
  warmMaxSizeMb: number;
}

export interface MemoryTierMetrics {
  totalDocuments: number;
  totalSizeBytes: number;
  hotCount: number;
  warmCount: number;
  coldCount: number;
  prunedCount: number;
  promotedCount: number;
  demotedCount: number;
}

export const DEFAULT_TIER_CONFIG: MemoryTierConfig = {
  hotToWarmDays: 7,
  warmToWoldDays: 90,
  coldPruneAfterDays: 365,
  hotMaxSizeMb: 500,
  warmMaxSizeMb: 5000
};

/**
 * Memory tier policy engine
 * Manages document lifecycle across hot/warm/cold tiers
 */
export class MemoryTierPolicy {
  private metrics: MemoryTierMetrics = {
    totalDocuments: 0,
    totalSizeBytes: 0,
    hotCount: 0,
    warmCount: 0,
    coldCount: 0,
    prunedCount: 0,
    promotedCount: 0,
    demotedCount: 0
  };

  constructor(private config: MemoryTierConfig = DEFAULT_TIER_CONFIG) {}

  /**
   * Classify a document's tier based on metadata
   */
  classifyTier(metadata: {
    ageMs: number;
    sizeBytes: number;
    accessCount: number;
    lastAccessMs: number;
  }): MemoryTier {
    const ageDays = metadata.ageMs / (24 * 60 * 60 * 1000);
    const lastAccessDays = (Date.now() - metadata.lastAccessMs) / (24 * 60 * 60 * 1000);

    // Hot: very recent or frequently accessed
    if (ageDays <= this.config.hotToWarmDays || metadata.accessCount > 10) {
      return "hot";
    }

    // Warm: medium age (accessed recently but not frequently)
    if (ageDays <= this.config.warmToWoldDays && lastAccessDays <= 30) {
      return "warm";
    }

    // Cold: old and rarely accessed
    return "cold";
  }

  /**
   * Promote a document to a higher tier (cold → warm or warm → hot)
   */
  promote(currentTier: MemoryTier): MemoryTier {
    if (currentTier === "cold") {
      this.metrics.promotedCount++;
      return "warm";
    }
    if (currentTier === "warm") {
      this.metrics.promotedCount++;
      return "hot";
    }
    return currentTier;
  }

  /**
   * Demote a document to a lower tier (hot → warm or warm → cold)
   */
  demote(currentTier: MemoryTier): MemoryTier {
    if (currentTier === "hot") {
      this.metrics.demotedCount++;
      return "warm";
    }
    if (currentTier === "warm") {
      this.metrics.demotedCount++;
      return "cold";
    }
    return currentTier;
  }

  /**
   * Determine if a document should be pruned
   */
  shouldPrune(tier: MemoryTier, metadata: {
    ageMs: number;
    lastAccessMs: number;
  }): boolean {
    if (tier !== "cold") {
      return false;
    }

    const ageDays = metadata.ageMs / (24 * 60 * 60 * 1000);
    const lastAccessDays = (Date.now() - metadata.lastAccessMs) / (24 * 60 * 60 * 1000);

    // Prune cold docs older than config + not accessed in 2x retention period
    return ageDays > this.config.coldPruneAfterDays && 
           lastAccessDays > this.config.coldPruneAfterDays;
  }

  /**
   * Update metrics
   */
  updateMetrics(update: Partial<MemoryTierMetrics>): void {
    this.metrics = { ...this.metrics, ...update };
  }

  /**
   * Get current metrics
   */
  getMetrics(): MemoryTierMetrics {
    return { ...this.metrics };
  }

  /**
   * Reset metrics
   */
  resetMetrics(): void {
    this.metrics = {
      totalDocuments: 0,
      totalSizeBytes: 0,
      hotCount: 0,
      warmCount: 0,
      coldCount: 0,
      prunedCount: 0,
      promotedCount: 0,
      demotedCount: 0
    };
  }

  /**
   * Get tier distribution
   */
  getTierDistribution(): Record<MemoryTier, number> {
    return {
      hot: this.metrics.hotCount,
      warm: this.metrics.warmCount,
      cold: this.metrics.coldCount
    };
  }

  /**
   * Calculate estimated storage cost based on tier distribution
   */
  estimateStorageCost(): {
    hotCost: number;
    warmCost: number;
    coldCost: number;
    totalCost: number;
  } {
    // Rough AWS pricing: hot (EBS) $0.10/GB/mo, warm (RDS) $0.06/GB/mo, cold (S3) $0.004/GB/mo
    const hotGb = this.metrics.hotCount * 0.1; // assume 100MB per doc
    const warmGb = this.metrics.warmCount * 0.1;
    const coldGb = this.metrics.coldCount * 0.1;

    return {
      hotCost: hotGb * 0.10,
      warmCost: warmGb * 0.06,
      coldCost: coldGb * 0.004,
      totalCost: (hotGb * 0.10) + (warmGb * 0.06) + (coldGb * 0.004)
    };
  }
}
