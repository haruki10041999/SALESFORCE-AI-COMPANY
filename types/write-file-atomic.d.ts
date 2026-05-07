/**
 * Type definitions for write-file-atomic
 * https://github.com/npm/write-file-atomic
 */

declare module "write-file-atomic" {
  interface WriteFileAtomicOptions {
    chown?: { uid: number; gid: number } | false;
    encoding?: string | null;
    fsync?: boolean;
    mode?: number | false;
    tmpfileCreated?: (filename: string) => void;
  }

  function writeFileAtomic(
    filename: string,
    data: string | Buffer,
    options?: WriteFileAtomicOptions | string,
    callback?: (err: NodeJS.ErrnoException | null) => void
  ): Promise<void>;

  namespace writeFileAtomic {
    function sync(
      filename: string,
      data: string | Buffer,
      options?: WriteFileAtomicOptions | string
    ): void;
  }

  export = writeFileAtomic;
}
