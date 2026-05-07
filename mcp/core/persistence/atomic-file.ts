import { promises as fsPromises } from "node:fs";
import { basename, dirname, join } from "node:path";
import writeFileAtomic from "write-file-atomic";

/**
 * write-file-atomic を使用してアトミックにファイルを書き込む。
 * 
 * write-file-atomic:
 * - 一時ファイルへの書き込み
 * - 原子的な rename で置き換え
 * - エラー時の自動クリーンアップ
 * - プロセス終了時の cleanup ハンドラ登録
 */
export async function writeTextFileAtomic(targetFile: string, payload: string): Promise<void> {
  await fsPromises.mkdir(dirname(targetFile), { recursive: true });
  // write-file-atomic returns a Promise when called without callback
  return writeFileAtomic(targetFile, payload, { encoding: "utf-8" });
}

export async function appendTextFileAtomic(targetFile: string, appendedText: string): Promise<void> {
  const current = await fsPromises.readFile(targetFile, "utf-8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return "";
    }
    throw error;
  });
  await writeTextFileAtomic(targetFile, current + appendedText);
}

export async function removeIfExists(targetFile: string): Promise<void> {
  try {
    await fsPromises.unlink(targetFile);
  } catch {
    // 削除競合や未存在は無視する。
  }
}

/**
 * cleanupStaleTempFiles
 * 
 * 古いスタイルの temp ファイルをクリーンアップする。
 * パターン: `.${basename}.${pid}.${timestamp}.tmp` または `.${basename}.${pid}.${random}.tmp`
 */
export async function cleanupStaleTempFiles(targetFile: string): Promise<void> {
  const targetDir = dirname(targetFile);
  const targetBase = basename(targetFile);
  const tempPrefix = `.${targetBase}.`;

  try {
    const entries = await fsPromises.readdir(targetDir, { withFileTypes: true });
    const staleTempFiles = entries
      .filter((entry) => entry.isFile() && entry.name.startsWith(tempPrefix) && entry.name.endsWith(".tmp"))
      .map((entry) => join(targetDir, entry.name));

    await Promise.all(
      staleTempFiles.map(async (tempFile) => {
        await removeIfExists(tempFile);
      })
    );
  } catch {
    // ディレクトリ読み取り失敗はロード処理を継続する。
  }
}