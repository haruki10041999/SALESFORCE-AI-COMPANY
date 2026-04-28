/**
 * atomic-write.ts
 *
 * ファイルをアトミックに書き込むユーティリティ。
 *
 * 方式:
 *   1. 対象と同ディレクトリに `.tmp.<pid>.<random>` ファイルを書く
 *   2. renameSync でターゲットに置き換える
 *
 * NTFS / ext4 とも同一ドライブ/マウントポイント内の rename は
 * writeFileSync の「切り詰め → 書き込み」よりはるかに安全。
 * 万が一 rename が失敗した場合は tmp を削除してエラーを再スロー。
 */

import {
  existsSync,
  mkdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

/**
 * `content` を `targetPath` にアトミックに書き込む。
 * 書き込み失敗時は tmp ファイルを削除し、エラーを再スローする。
 */
export function atomicWriteFileSync(
  targetPath: string,
  content: string | Buffer,
  encoding: BufferEncoding = "utf-8"
): void {
  const dir = dirname(targetPath);
  mkdirSync(dir, { recursive: true });

  const rand = Math.floor(Math.random() * 0xffff).toString(16).padStart(4, "0");
  const tmp = join(dir, `.tmp.${process.pid}.${rand}`);

  try {
    writeFileSync(tmp, content, encoding);
    renameSync(tmp, targetPath);
  } catch (err) {
    // tmp が残っていれば後処理
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      // ignore cleanup failure
    }
    throw err;
  }
}
