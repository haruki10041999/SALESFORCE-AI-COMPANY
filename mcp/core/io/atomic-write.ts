/**
 * atomic-write.ts
 *
 * ファイルをアトミックに書き込むユーティリティ。
 *
 * write-file-atomic ライブラリを使用してアトミックな書き込みを実現する。
 * このライブラリは以下を保証する:
 *   - 一時ファイルへの書き込み
 *   - 原子的な rename で置き換え
 *   - エラー時の自動クリーンアップ
 *   - プロセス終了時の cleanup ハンドラ登録
 */

import writeFileAtomic from "write-file-atomic";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * `content` を `targetPath` にアトミックに書き込む。
 * write-file-atomic の sync API を使用。
 * 書き込み失敗時は自動的に tmp ファイルが削除される。
 */
export function atomicWriteFileSync(
  targetPath: string,
  content: string | Buffer,
  encoding: BufferEncoding = "utf-8"
): void {
  const dir = dirname(targetPath);
  mkdirSync(dir, { recursive: true });

  writeFileAtomic.sync(targetPath, content, { encoding });
}
