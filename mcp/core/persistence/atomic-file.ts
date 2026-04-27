import { promises as fsPromises } from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, join } from "node:path";

export function buildTempFilePath(targetFile: string): string {
  const targetDir = dirname(targetFile);
  const targetBase = basename(targetFile);
  return join(targetDir, `.${targetBase}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`);
}

export async function removeIfExists(targetFile: string): Promise<void> {
  try {
    await fsPromises.unlink(targetFile);
  } catch {
    // 削除競合や未存在は無視する。
  }
}

export async function renameOrReplace(sourceFile: string, targetFile: string): Promise<void> {
  try {
    await fsPromises.rename(sourceFile, targetFile);
  } catch {
    try {
      const payload = await fsPromises.readFile(sourceFile, "utf-8");
      await fsPromises.writeFile(targetFile, payload, "utf-8");
    } finally {
      await removeIfExists(sourceFile);
    }
  }
}

export async function createStagedTextFile(targetFile: string, payload: string): Promise<string> {
  await fsPromises.mkdir(dirname(targetFile), { recursive: true });
  const tempFile = buildTempFilePath(targetFile);
  await fsPromises.writeFile(tempFile, payload, "utf-8");
  return tempFile;
}

export async function writeTextFileAtomic(targetFile: string, payload: string): Promise<void> {
  const tempFile = await createStagedTextFile(targetFile, payload);
  await renameOrReplace(tempFile, targetFile);
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

export async function cleanupStaleTempFiles(targetFile: string): Promise<void> {
  const targetDir = dirname(targetFile);
  const tempPrefix = `.${basename(targetFile)}.`;

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