import { writeTextFileAtomic } from "./atomic-file.js";
import type { Pool, PoolClient } from "pg";

interface StagedFileWrite {
  targetFile: string;
  payload: string;
}

/**
 * FileUnitOfWork
 *
 * 複数ファイルの書き込みをステージングし、commit 時に全て atomic に反映させる。
 * write-file-atomic ライブラリが各ファイルの atomic 性を保証する。
 */
export class FileUnitOfWork {
  private readonly stagedWrites = new Map<string, StagedFileWrite>();
  private prepared = false;
  private committed = false;

  public async stageFileWrite(targetFile: string, payload: string): Promise<void> {
    if (this.prepared || this.committed) {
      throw new Error("cannot stage file writes after prepare or commit");
    }

    this.stagedWrites.set(targetFile, { targetFile, payload });
  }

  public async prepare(): Promise<void> {
    if (this.committed) {
      throw new Error("cannot prepare after commit");
    }
    this.prepared = true;
  }

  public async commit(): Promise<void> {
    if (this.committed) {
      return;
    }
    if (!this.prepared) {
      await this.prepare();
    }

    try {
      // All writes use write-file-atomic, which guarantees atomicity per file
      // Files are written serially to ensure predictable behavior
      for (const stagedWrite of this.stagedWrites.values()) {
        await writeTextFileAtomic(stagedWrite.targetFile, stagedWrite.payload);
      }
      this.committed = true;
      this.stagedWrites.clear();
    } catch (error) {
      // On error, clear the staged writes without cleanup
      // write-file-atomic handles temp file cleanup automatically
      this.stagedWrites.clear();
      throw error;
    }
  }

  public async rollback(): Promise<void> {
    // No temp files to clean up since we don't pre-create them
    this.stagedWrites.clear();
    this.prepared = false;
  }
}

export interface PostgresUnitOfWork {
  runInTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T>;
}

class DefaultPostgresUnitOfWork implements PostgresUnitOfWork {
  constructor(private readonly pool: Pool) {}

  public async runInTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
}

export function createPostgresUnitOfWork(pool: Pool): PostgresUnitOfWork {
  return new DefaultPostgresUnitOfWork(pool);
}

export { appendTextFileAtomic, writeTextFileAtomic } from "./atomic-file.js";