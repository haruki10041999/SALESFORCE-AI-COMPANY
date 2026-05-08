import { SecretsBackend } from "./types.js";

/**
 * Environment variable based secrets backend
 * Reads secrets from process.env
 * No version tracking (all versions are "env")
 * No set/delete support
 */
export class EnvSecretsBackend implements SecretsBackend {
  async getSecret(
    name: string,
  ): Promise<{ value: string; version: string }> {
    const value = process.env[name];

    if (!value) {
      throw new Error(`Secret not found: ${name}`);
    }

    return {
      value,
      version: "env", // Static version for env backend
    };
  }

}
