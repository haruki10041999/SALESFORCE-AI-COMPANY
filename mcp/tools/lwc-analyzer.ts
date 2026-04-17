import fs from "node:fs";

export type LwcFileAnalysis = {
  path: string;
  usesWire: boolean;
  hasApiDecorator: boolean;
};

export function analyzeLwc(filePath: string): LwcFileAnalysis {
  const src = fs.readFileSync(filePath, "utf-8");
  return {
    path: filePath,
    usesWire: /@wire\b/.test(src),
    hasApiDecorator: /@api\b/.test(src)
  };
}
