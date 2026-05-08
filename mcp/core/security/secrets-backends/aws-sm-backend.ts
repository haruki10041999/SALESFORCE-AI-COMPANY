import type { SecretsBackend } from "./types.js";

type SecretsClient = {
  send: (command: unknown) => Promise<{
    SecretString?: string;
    VersionId?: string;
  }>;
};

type AwsSdkModule = {
  SecretsManagerClient: new (options: { region: string }) => SecretsClient;
  GetSecretValueCommand: new (options: { SecretId: string }) => unknown;
  PutSecretValueCommand: new (options: { SecretId: string; SecretString: string }) => unknown;
};

/**
 * AWS Secrets Manager backend.
 *
 * This backend uses dynamic import so the core package can run without
 * hard dependency on the AWS SDK in local-only environments.
 */
export class AwsSecretsManagerBackend implements SecretsBackend {
  private readonly region: string;
  private sdkPromise: Promise<AwsSdkModule> | null = null;
  private clientPromise: Promise<SecretsClient> | null = null;
  private readonly dynamicImport: (moduleName: string) => Promise<unknown>;

  constructor(options: { region: string }) {
    this.region = options.region;
    this.dynamicImport = new Function("moduleName", "return import(moduleName)") as (
      moduleName: string,
    ) => Promise<unknown>;
  }

  private async loadSdk(): Promise<AwsSdkModule> {
    if (!this.sdkPromise) {
      this.sdkPromise = this.dynamicImport("@aws-sdk/client-secrets-manager")
        .then((module) => module as unknown as AwsSdkModule)
        .catch(() => {
          throw new Error(
            "AWS Secrets Manager backend requires '@aws-sdk/client-secrets-manager'. Install it with: npm install @aws-sdk/client-secrets-manager",
          );
        });
    }
    return this.sdkPromise;
  }

  private async getClient(): Promise<SecretsClient> {
    if (!this.clientPromise) {
      this.clientPromise = this.loadSdk().then((sdk) => {
        return new sdk.SecretsManagerClient({ region: this.region });
      });
    }
    return this.clientPromise;
  }

  async getSecret(name: string): Promise<{ value: string; version: string }> {
    const sdk = await this.loadSdk();
    const client = await this.getClient();
    const result = await client.send(
      new sdk.GetSecretValueCommand({
        SecretId: name,
      }),
    );

    if (typeof result.SecretString !== "string") {
      throw new Error(`AWS secret value is not string: ${name}`);
    }

    return {
      value: result.SecretString,
      version: result.VersionId ?? "aws-sm",
    };
  }

  async setSecret(name: string, value: string): Promise<void> {
    const sdk = await this.loadSdk();
    const client = await this.getClient();
    await client.send(
      new sdk.PutSecretValueCommand({
        SecretId: name,
        SecretString: value,
      }),
    );
  }

  async deleteSecret(_name: string): Promise<void> {
    throw new Error("Delete operation is not supported by AwsSecretsManagerBackend");
  }
}
