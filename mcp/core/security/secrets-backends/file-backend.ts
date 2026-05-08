import { promises as fs } from "fs";
import * as path from "path";
import { SecretsBackend } from "./types.js";

/**
 * File-based secrets backend
 * Reads secrets from a directory of files (.secrets/)
 * Each secret name maps to a file
 * Supports set/delete operations
 * Version tracking via file mtime
 */
export class FileSecretsBackend implements SecretsBackend {
  private basePath: string;

  constructor(basePath: string = ".secrets") {
    this.basePath = basePath;
  }

  private getFilePath(name: string): string {
    // Sanitize name to prevent path traversal
    const safeName = name.replace(/[^a-zA-Z0-9._-]/g, "_");
    return path.join(this.basePath, safeName);
  }

  async getSecret(
    name: string,
  ): Promise<{ value: string; version: string }> {
    const filePath = this.getFilePath(name);

    try {
      const [content, stats] = await Promise.all([
        fs.readFile(filePath, "utf-8"),
        fs.stat(filePath),
      ]);

      // Version is mtime.getTime() as string for change detection
      const version = stats.mtime.getTime().toString();

      return {
        value: content.trim(),
        version,
      };
    } catch (error: any) {
      if (error.code === "ENOENT") {
        throw new Error(`Secret file not found: ${name}`);
      }
      throw error;
    }
  }

  async setSecret(name: string, value: string): Promise<void> {
    const filePath = this.getFilePath(name);

    // Create directory if needed
    await fs.mkdir(this.basePath, { recursive: true });

    // Write with secure permissions (0600 on Unix)
    await fs.writeFile(filePath, value, {
      mode: 0o600,
      encoding: "utf-8",
    });
  }

  async deleteSecret(name: string): Promise<void> {
    const filePath = this.getFilePath(name);

    try {
      await fs.unlink(filePath);
    } catch (error: any) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }
}
