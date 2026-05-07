import {
  cleanupStaleTempFiles,
  removeIfExists,
  writeTextFileAtomic
} from "../persistence/atomic-file.js";

/**
 * TemporaryFileManager
 *
 * Atomic file operations を提供するマネージャー。
 * write-file-atomic ライブラリを通じて atomic 性を保証。
 */
export class TemporaryFileManager {
  public static async removeIfExists(targetFile: string): Promise<void> {
    await removeIfExists(targetFile);
  }

  public static async writeAtomic(targetFile: string, payload: string): Promise<void> {
    await writeTextFileAtomic(targetFile, payload);
  }

  public static async cleanupStaleTempFiles(targetFile: string): Promise<void> {
    await cleanupStaleTempFiles(targetFile);
  }
}
