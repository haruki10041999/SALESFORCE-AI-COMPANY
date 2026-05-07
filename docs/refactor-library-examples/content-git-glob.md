# gray-matter / yaml / simple-git / fast-glob

## 役割

- `gray-matter`: Markdown frontmatter 解析
- `yaml`: YAML パース
- `simple-git`: Git 操作ラッパ
- `fast-glob`: 高速ファイル探索

## 想定適用箇所

- [mcp/core/declarative/frontmatter.ts](../mcp/core/declarative/frontmatter.ts)
- [mcp/tools/git-diff-helpers.ts](../mcp/tools/git-diff-helpers.ts)
- [scripts/run-selective-tests.ts](../scripts/run-selective-tests.ts)
- [scripts/cleanup-outputs.ts](../scripts/cleanup-outputs.ts)
- [mcp/core/context/markdown-catalog.ts](../mcp/core/context/markdown-catalog.ts)

## gray-matter 例

```ts
import matter from "gray-matter";
import YAML from "yaml";

const parsed = matter(source, {
  engines: { yaml: (text) => YAML.parse(text) }
});

const data = parsed.data;
const body = parsed.content;
```

## simple-git 例

```ts
import { simpleGit } from "simple-git";

const git = simpleGit(process.cwd());
const diff = await git.diff(["HEAD~1", "HEAD"]);
const status = await git.status();
```

## fast-glob 例

```ts
import fg from "fast-glob";

const files = await fg(["outputs/**/*.jsonl", "outputs/**/*.json"], {
  dot: true,
  onlyFiles: true
});
```

## 注意点

- frontmatter は `gray-matter`、最終 validation は zod にする
- Git ラッパ導入後も git 実行結果のエラー文脈は保持する
- `fast-glob` は ignore 設定を明示して性能を安定させる
