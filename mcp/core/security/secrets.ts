import { EventEmitter } from "events";
import { SecretsBackend } from "./secrets-backends/types.js";
import { EnvSecretsBackend } from "./secrets-backends/env-backend.js";
import { FileSecretsBackend } from "./secrets-backends/file-backend.js";
import { VaultSecretsBackend } from "./secrets-backends/vault-backend.js";
import { AwsSecretsManagerBackend } from "./secrets-backends/aws-sm-backend.js";
import { getNodeEnv, getSecretsEnvConfig } from "../config/runtime-config.js";

/**
 * Configuration for secrets manager
 */
export interface SecretsConfig {
  backend: "env" | "file" | "vault" | "aws-sm";
  ttlMs?: number; // Cache TTL (default: 5 minutes)
  rotationCheckMs?: number; // How often to check for rotated secrets (default: 1 minute)
  auditEnabled?: boolean; // Log secret access (default: true)
  vaultAddr?: string; // For vault backend
  vaultToken?: string; // For vault backend
  vaultMount?: string; // default: secret
  vaultValueField?: string; // default: value
  awsRegion?: string; // For aws-sm backend
  filePath?: string; // For file backend
}

/**
 * Cached secret entry with version and expiry
 */
interface CachedSecret {
  value: string;
  version: string;
  expiresAt: number;
}

/**
 * Secrets Manager abstraction layer
 *
 * Supports multiple backends: env (default), file, vault, aws-sm
 * Features:
 * - TTL-based caching with rotation detection
 * - Audit logging for all access
 * - Version tracking for key rotation
 * - Async API for backend flexibility
 */
export class SecretsManager extends EventEmitter {
  private backend: SecretsBackend;
  private config: SecretsConfig;
  private cache: Map<string, CachedSecret> = new Map();
  private rotationCheckTimer?: NodeJS.Timeout;

  constructor(config: SecretsConfig) {
    super();
    this.config = {
      ttlMs: 5 * 60 * 1000, // 5 minutes
      rotationCheckMs: 60 * 1000, // 1 minute
      auditEnabled: true,
      ...config,
    };

    this.backend = this.initializeBackend();

    // Start rotation check timer
    if (this.config.rotationCheckMs && this.config.rotationCheckMs > 0) {
      this.rotationCheckTimer = setInterval(() => {
        this.checkForRotations();
      }, this.config.rotationCheckMs);
      this.rotationCheckTimer.unref(); // Don't keep process alive
    }
  }

  /**
   * Initialize the appropriate backend
   */
  private initializeBackend(): SecretsBackend {
    switch (this.config.backend) {
      case "file":
        return new FileSecretsBackend(this.config.filePath || ".secrets");
      case "vault":
        if (!this.config.vaultAddr || !this.config.vaultToken) {
          throw new Error("Vault backend requires vaultAddr and vaultToken");
        }
        return new VaultSecretsBackend({
          addr: this.config.vaultAddr,
          authValue: this.config.vaultToken,
          mount: this.config.vaultMount,
          valueField: this.config.vaultValueField,
        });
      case "aws-sm":
        return new AwsSecretsManagerBackend({
          region: this.config.awsRegion ?? "ap-northeast-1",
        });
      case "env":
      default:
        return new EnvSecretsBackend();
    }
  }

  /**
   * Get a secret value
   * Checks cache first, then backend, with TTL and version tracking
   *
   * @param name Secret name (e.g., "OPENAI_API_KEY")
   * @param options Retrieval options (ttl override, version check)
   * @returns Secret value
   */
  async getSecret(
    name: string,
    options: {
      ttlMs?: number;
      checkRotation?: boolean;
    } = {},
  ): Promise<string> {
    const ttl = options.ttlMs ?? this.config.ttlMs;

    // Check cache
    const cached = this.cache.get(name);
    if (cached && cached.expiresAt > Date.now() && !options.checkRotation) {
      await this.recordAccess(name, "cache_hit");
      return cached.value;
    }

    // Fetch from backend
    const { value, version } = await this.backend.getSecret(name);

    // Check for rotation
    if (options.checkRotation && cached && cached.version !== version) {
      this.emit("secret-rotated", {
        name,
        oldVersion: cached.version,
        newVersion: version,
      });
      await this.recordAccess(name, "secret_rotated");
    }

    // Cache the result
    this.cache.set(name, {
      value,
      version,
      expiresAt: Date.now() + (ttl ?? 0),
    });

    await this.recordAccess(name, "backend_fetch");
    return value;
  }

  /**
   * Set a secret (if backend supports it)
   */
  async setSecret(name: string, value: string): Promise<void> {
    if (!this.backend.setSecret) {
      throw new Error(`Backend ${this.config.backend} does not support setting secrets`);
    }

    await this.backend.setSecret(name, value);
    this.cache.delete(name); // Invalidate cache
    await this.recordAccess(name, "secret_set");
  }

  /**
   * Delete a secret (if backend supports it)
   */
  async deleteSecret(name: string): Promise<void> {
    if (!this.backend.deleteSecret) {
      throw new Error(
        `Backend ${this.config.backend} does not support deleting secrets`,
      );
    }

    await this.backend.deleteSecret(name);
    this.cache.delete(name);
    await this.recordAccess(name, "secret_deleted");
  }

  /**
   * Check if any cached secrets have been rotated
   */
  private async checkForRotations(): Promise<void> {
    for (const [name] of this.cache) {
      try {
        await this.getSecret(name, { checkRotation: true });
      } catch {
        // Silently skip if backend fails
      }
    }
  }

  /**
   * Record secret access for audit
   */
  private async recordAccess(
    name: string,
    action: string,
  ): Promise<void> {
    if (!this.config.auditEnabled) {
      return;
    }

    try {
      // TODO: Integrate with audit-writer when needed
      // For now, just log to console in development
      if (getNodeEnv() !== "production") {
        console.debug(`[Secrets] ${action}: ${name}`);
      }
    } catch {
      // audit logging should never block secret access
    }
  }

  /**
   * Invalidate all cached secrets
   */
  invalidateCache(): void {
    this.cache.clear();
  }

  /**
   * Invalidate specific secret from cache
   */
  invalidateSecret(name: string): void {
    this.cache.delete(name);
  }

  /**
   * Get cache statistics (for monitoring)
   */
  getCacheStats(): {
    size: number;
    keys: string[];
    expiredCount: number;
  } {
    const now = Date.now();
    let expiredCount = 0;

    for (const entry of this.cache.values()) {
      if (entry.expiresAt <= now) {
        expiredCount++;
      }
    }

    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
      expiredCount,
    };
  }

  /**
   * Cleanup on shutdown
   */
  destroy(): void {
    if (this.rotationCheckTimer) {
      clearInterval(this.rotationCheckTimer);
    }
    this.cache.clear();
    this.removeAllListeners();
  }
}

/**
 * Global singleton instance
 */
let globalSecretsManager: SecretsManager | null = null;

/**
 * Get or create global secrets manager instance
 */
export function getSecretsManager(
  config?: SecretsConfig,
): SecretsManager {
  if (!globalSecretsManager) {
    const envConfig = getSecretsEnvConfig();
    const backend = envConfig.backend ?? "env";
    globalSecretsManager = new SecretsManager({
      backend,
      auditEnabled: envConfig.auditEnabled,
      filePath: envConfig.filePath,
      vaultAddr: envConfig.vaultAddr,
      vaultToken: envConfig.vaultToken,
      vaultMount: envConfig.vaultMount,
      vaultValueField: envConfig.vaultValueField,
      awsRegion: envConfig.awsRegion,
      ...config,
    });
  }
  return globalSecretsManager;
}

/**
 * Convenience helper for single secret retrieval
 */
export async function getSecret(name: string): Promise<string> {
  return getSecretsManager().getSecret(name);
}

/**
 * Hydrate selected environment variables from secret backend.
 *
 * Mapping format:
 * - explicit map: { ENV_KEY: "secret-name" }
 * - loads only when ENV_KEY is currently empty
 */
export async function hydrateEnvFromSecrets(
  map: Record<string, string>,
  manager?: SecretsManager,
): Promise<{ loaded: string[]; failed: Array<{ envKey: string; reason: string }> }> {
  const loaded: string[] = [];
  const failed: Array<{ envKey: string; reason: string }> = [];
  const sm = manager ?? getSecretsManager();

  for (const [envKey, secretName] of Object.entries(map)) {
    if (!secretName || process.env[envKey]) {
      continue;
    }
    try {
      process.env[envKey] = await sm.getSecret(secretName);
      loaded.push(envKey);
    } catch (error) {
      failed.push({
        envKey,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { loaded, failed };
}
