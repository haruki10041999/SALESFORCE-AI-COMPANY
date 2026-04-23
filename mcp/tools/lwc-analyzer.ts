import fs from "node:fs";
import { SafeFilePathSchema, runSchemaValidation } from "../core/quality/resource-validation.js";

export type LwcFileAnalysis = {
  path: string;
  usesWire: boolean;
  hasApiDecorator: boolean;
  hasImperativeApex: boolean;
  usesNavigationMixin: boolean;
  usesCustomLabels: boolean;
  hasEventDispatch: boolean;
  hasRenderedCallbackHeavyRisk: boolean;
  hasEventListenerLeakRisk: boolean;
  hasUnsafeInnerHtmlRisk: boolean;
  trackDecoratorCount: number;
};

export function analyzeLwc(filePath: string): LwcFileAnalysis {
  const pathCheck = runSchemaValidation(SafeFilePathSchema, filePath);
  if (!pathCheck.success) {
    throw new Error(`Invalid filePath: ${pathCheck.errors.join(", ")}`);
  }

  const src = fs.readFileSync(filePath, "utf-8");
  const hasLabelImport = /@salesforce\/label\//i.test(src);
  const usesLabelValue = /\b(label|labels)\b/i.test(src);
  const trackDecoratorCount = (src.match(/@track\b/g) ?? []).length;
  const hasRenderedCallback = /renderedCallback\s*\(/.test(src);
  const hasSyncDomQuery = /querySelector(All)?\s*\(/.test(src);
  const hasRenderedCallbackHeavyRisk = hasRenderedCallback && (hasSyncDomQuery || /for\s*\(|while\s*\(/.test(src));
  const hasWindowEventListener = /window\.addEventListener\s*\(/.test(src);
  const hasCleanupListener = /disconnectedCallback\s*\([\s\S]*?(removeEventListener)/.test(src);
  const hasEventListenerLeakRisk = hasWindowEventListener && !hasCleanupListener;
  const hasUnsafeInnerHtmlRisk = /\.innerHTML\s*=/.test(src) || /lwc:dom="manual"/.test(src);

  return {
    path: filePath,
    usesWire: /@wire\b/.test(src),
    hasApiDecorator: /@api\b/.test(src),
    hasImperativeApex: /import\s+\w+\s+from\s+'@salesforce\/apex\//i.test(src) && !/@wire/.test(src),
    usesNavigationMixin: /NavigationMixin\.Navigate/.test(src),
    usesCustomLabels: hasLabelImport || usesLabelValue,
    hasEventDispatch: /dispatchEvent\s*\(|new\s+CustomEvent\s*\(/.test(src),
    hasRenderedCallbackHeavyRisk,
    hasEventListenerLeakRisk,
    hasUnsafeInnerHtmlRisk,
    trackDecoratorCount
  };
}
