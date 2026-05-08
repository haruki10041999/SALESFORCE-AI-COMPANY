import type { SecretsBackend } from "./types.js";

interface VaultResponse {
  data?: {
    data?: Record<string, unknown>;
    metadata?: {
      version?: number;
    };
  };
}

/**
 * Vault KV-v2 backend.
 *
 * Secret read endpoint:
 *   GET {addr}/v1/{mount}/data/{secretName}
 */
export class VaultSecretsBackend implements SecretsBackend {
  private readonly addr: string;
  private readonly authValue: string;
  private readonly mount: string;
  private readonly valueField: string;

  constructor(options: {
    addr: string;
    token?: string;
    authValue?: string;
    mount?: string;
    valueField?: string;
  }) {
    this.addr = options.addr.replace(/\/$/, "");
    this.authValue = options.authValue ?? options.token ?? "";
    if (!this.authValue) {
      throw new Error("Vault auth value is required");
    }
    this.mount = options.mount ?? "secret";
    this.valueField = options.valueField ?? "value";
  }

  async getSecret(name: string): Promise<{ value: string; version: string }> {
    const url = `${this.addr}/v1/${this.mount}/data/${encodeURIComponent(name)}`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "X-Vault-Token": this.authValue,
      },
    });

    if (!response.ok) {
      throw new Error(`Vault secret read failed (${response.status}): ${name}`);
    }

    const payload = (await response.json()) as VaultResponse;
    const secretData = payload.data?.data;
    if (!secretData) {
      throw new Error(`Vault secret missing payload: ${name}`);
    }

    const value = secretData[this.valueField] ?? secretData.value ?? secretData[name];
    if (typeof value !== "string") {
      throw new Error(`Vault secret value must be string: ${name}`);
    }

    const version = String(payload.data?.metadata?.version ?? "vault");
    return { value, version };
  }

  async setSecret(name: string, value: string): Promise<void> {
    const url = `${this.addr}/v1/${this.mount}/data/${encodeURIComponent(name)}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "X-Vault-Token": this.authValue,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        data: {
          [this.valueField]: value,
        },
      }),
    });
    if (!response.ok) {
      throw new Error(`Vault secret write failed (${response.status}): ${name}`);
    }
  }

  async deleteSecret(name: string): Promise<void> {
    const url = `${this.addr}/v1/${this.mount}/metadata/${encodeURIComponent(name)}`;
    const response = await fetch(url, {
      method: "DELETE",
      headers: {
        "X-Vault-Token": this.authValue,
      },
    });
    if (!response.ok && response.status !== 404) {
      throw new Error(`Vault secret delete failed (${response.status}): ${name}`);
    }
  }
}
