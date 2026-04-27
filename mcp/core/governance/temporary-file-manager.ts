import {
  buildTempFilePath,
  cleanupStaleTempFiles,
  removeIfExists,
  renameOrReplace,
  writeTextFileAtomic
} from "../persistence/atomic-file.js";

export class TemporaryFileManager {
  public static buildTempFilePath(targetFile: string): string {
    return buildTempFilePath(targetFile);
  }

  public static async removeIfExists(targetFile: string): Promise<void> {
    await removeIfExists(targetFile);
  }

  public static async renameOrReplace(sourceFile: string, targetFile: string): Promise<void> {
    await renameOrReplace(sourceFile, targetFile);
  }

  public static async writeAtomic(targetFile: string, payload: string): Promise<void> {
    await writeTextFileAtomic(targetFile, payload);
  }

  public static async cleanupStaleTempFiles(targetFile: string): Promise<void> {
    await cleanupStaleTempFiles(targetFile);
  }
}
