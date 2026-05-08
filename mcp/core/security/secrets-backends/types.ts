/**
 * Interface for secret backends
 * Implementations must provide getSecret and optionally setSecret/deleteSecret
 */
export interface SecretsBackend {
  /**
   * Retrieve a secret with version tracking
   */
  getSecret(name: string): Promise<{ value: string; version: string }>;

  /**
   * Optional: Set a secret (not all backends support this)
   */
  setSecret?(name: string, value: string): Promise<void>;

  /**
   * Optional: Delete a secret (not all backends support this)
   */
  deleteSecret?(name: string): Promise<void>;
}
