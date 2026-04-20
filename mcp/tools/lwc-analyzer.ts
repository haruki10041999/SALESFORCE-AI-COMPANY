import fs from "node:fs";

export type LwcFileAnalysis = {
  path: string;
  usesWire: boolean;
  hasApiDecorator: boolean;
  hasImperativeApex: boolean;
  usesNavigationMixin: boolean;
  usesCustomLabels: boolean;
  hasEventDispatch: boolean;
};

export function analyzeLwc(filePath: string): LwcFileAnalysis {
  const src = fs.readFileSync(filePath, "utf-8");
  return {
    path: filePath,
    usesWire: /@wire\b/.test(src),
    hasApiDecorator: /@api\b/.test(src),
    hasImperativeApex: /import\s+\w+\s+from\s+'@salesforce\/apex\//i.test(src) && !/@wire/.test(src),
    usesNavigationMixin: /NavigationMixin\.Navigate/.test(src),
    usesCustomLabels: /\$A\.get|this\.label|i18n\b|\/\/@salesforce\/label\//i.test(src),
    hasEventDispatch: /dispatchEvent\s*\(|new\s+CustomEvent\s*\(/.test(src)
  };
}
