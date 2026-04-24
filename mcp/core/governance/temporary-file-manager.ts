import { promises as fsPromises } from "fs";
import { basename, dirname, join } from "path";

export class TemporaryFileManager {
  public static buildTempFilePath(targetFile: string): string {
    const targetDir = dirname(targetFile);
    const targetBase = basename(targetFile);
    return join(targetDir, `.${targetBase}.${process.pid}.${Date.now()}.tmp`);
  }

  public static async writeAtomic(targetFile: string, payload: string): Promise<void> {
    const targetDir = dirname(targetFile);
    await fsPromises.mkdir(targetDir, { recursive: true });

    const tempFile = this.buildTempFilePath(targetFile);
    await fsPromises.writeFile(tempFile, payload, "utf-8");

    try {
      await fsPromises.rename(tempFile, targetFile);
    } catch {
      try {
        await fsPromises.unlink(tempFile);
      } catch {
        // temp ファイル削除失敗は無視
      }
      await fsPromises.writeFile(targetFile, payload, "utf-8");
    }
  }

  public static async cleanupStaleTempFiles(targetFile: string): Promise<void> {
    const targetDir = dirname(targetFile);
    const tempPrefix = `.${basename(targetFile)}.`;

    try {
      const entries = await fsPromises.readdir(targetDir, { withFileTypes: true });
      const staleTempFiles = entries
        .filter((entry) => entry.isFile() && entry.name.startsWith(tempPrefix) && entry.name.endsWith(".tmp"))
        .map((entry) => join(targetDir, entry.name));

      await Promise.all(
        staleTempFiles.map(async (tempFile) => {
          try {
            await fsPromises.unlink(tempFile);
          } catch {
            // 競合した削除や一時的なロックは次回ロードで再試行する。
          }
        })
      );
    } catch {
      // ディレクトリ読み取り失敗はロード処理を継続する。
    }
  }
}
