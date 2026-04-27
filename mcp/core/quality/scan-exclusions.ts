/**
 * リポジトリ走査時に除外すべきディレクトリ名の共通定義。
 *
 * Salesforce CLI / IDE / 各種ビルドツールが生成するキャッシュ・依存・自動生成
 * ディレクトリは、実装コードを含まないかつサイズが大きいため、再帰スキャン対象から外す。
 *
 * このセットは「ディレクトリ basename 完全一致」で判定する。深い path 一致や
 * glob 解釈は意図的に行わない (誤って実コードを除外しないため)。
 */
export const REPO_SCAN_EXCLUDED_DIRS: ReadonlySet<string> = new Set<string>([
  // Salesforce
  ".sf",
  ".sfdx",
  // VCS / IDE
  ".git",
  ".hg",
  ".svn",
  ".vscode",
  ".idea",
  // Node / build
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".nuxt",
  ".cache",
  ".turbo",
  // Python など
  "__pycache__",
  ".venv"
]);

/**
 * ディレクトリ basename を渡して、走査をスキップすべきかどうかを返す。
 */
export function shouldSkipScanDir(name: string): boolean {
  return REPO_SCAN_EXCLUDED_DIRS.has(name);
}
