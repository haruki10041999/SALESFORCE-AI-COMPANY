import { promises as fsPromises } from "node:fs";
import {
  appendTextFileAtomic,
  createStagedTextFile,
  removeIfExists,
  renameOrReplace,
  writeTextFileAtomic
} from "./atomic-file.js";

interface StagedFileWrite {
  targetFile: string;
  tempFile: string;
}

export class FileUnitOfWork {
  private readonly stagedWrites = new Map<string, StagedFileWrite>();
  private prepared = false;
  private committed = false;

  public async stageFileWrite(targetFile: string, payload: string): Promise<void> {
    if (this.prepared || this.committed) {
      throw new Error("cannot stage file writes after prepare or commit");
    }

    const existing = this.stagedWrites.get(targetFile);
    if (existing) {
      await removeIfExists(existing.tempFile);
    }

    const tempFile = await createStagedTextFile(targetFile, payload);
    this.stagedWrites.set(targetFile, { targetFile, tempFile });
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

    const committedWrites: StagedFileWrite[] = [];

    try {
      for (const stagedWrite of this.stagedWrites.values()) {
        await renameOrReplace(stagedWrite.tempFile, stagedWrite.targetFile);
        committedWrites.push(stagedWrite);
      }
      this.committed = true;
      this.stagedWrites.clear();
    } catch (error) {
      await Promise.all(
        [...this.stagedWrites.values()].map((stagedWrite) => removeIfExists(stagedWrite.tempFile))
      );
      this.stagedWrites.clear();
      throw error;
    }
  }

  public async rollback(): Promise<void> {
    await Promise.all(
      [...this.stagedWrites.values()].map((stagedWrite) => removeIfExists(stagedWrite.tempFile))
    );
    this.stagedWrites.clear();
    this.prepared = false;
  }
}

export { appendTextFileAtomic, writeTextFileAtomic } from "./atomic-file.js";