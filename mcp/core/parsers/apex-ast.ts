/**
 * F-08: Apex AST analyzer
 *
 * `@apexdevtools/apex-parser` (ANTLR4 ベース) を用いて Apex ソースを構文解析し、
 * クラス / インタフェース / トリガ / メソッド / フィールド / アノテーションを抽出する。
 *
 * - 副作用なし。入力文字列から純粋に AST を生成しサマリ化する。
 * - パース失敗時は `errors` フィールドにエラーを記録し、部分解析でも継続。
 * - 既存の regex ベース推定 (`tools/apex-dependency-graph.ts`) より厳密な情報を提供する。
 */

import {
  ApexLexer,
  ApexParser,
  CommonTokenStream,
  type CompilationUnitContext,
  type TriggerUnitContext
} from "@apexdevtools/apex-parser";
import { CharStreams } from "antlr4ts";
import { ANTLRErrorListener, RecognitionException, Recognizer, Token } from "antlr4ts";
import { ATNSimulator } from "antlr4ts/atn/ATNSimulator.js";

export type ApexUnitKind = "class" | "interface" | "enum" | "trigger";

export interface ApexParameter {
  name: string;
  type: string;
}

export interface ApexMethod {
  name: string;
  returnType: string;
  modifiers: string[];
  annotations: string[];
  parameters: ApexParameter[];
}

export interface ApexField {
  name: string;
  type: string;
  modifiers: string[];
  annotations: string[];
}

export interface ApexProperty {
  name: string;
  type: string;
  modifiers: string[];
  annotations: string[];
}

export interface ApexInnerSummary {
  kind: ApexUnitKind;
  name: string;
}

export interface ApexUnitSummary {
  kind: ApexUnitKind;
  name: string;
  /** クラス: `extends X`、interface には適用しない */
  superType?: string;
  /** クラス: `implements A, B` / interface: `extends A, B` */
  implementsTypes: string[];
  modifiers: string[];
  annotations: string[];
  methods: ApexMethod[];
  fields: ApexField[];
  properties: ApexProperty[];
  innerTypes: ApexInnerSummary[];
  /** トリガのみ。発火イベント (before insert, after update など) */
  triggerEvents?: string[];
  /** トリガのみ。対象 sObject */
  triggerObject?: string;
}

export interface ApexParseError {
  line: number;
  column: number;
  message: string;
}

export interface ApexAnalysis {
  units: ApexUnitSummary[];
  errors: ApexParseError[];
  /** ファイル全体の SOQL 数 (regex ベース。AST だけでは難しいため補助情報) */
  soqlCount: number;
  /** ファイル全体の DML 数 (insert/update/delete/upsert/merge/undelete) */
  dmlCount: number;
}

class CollectingErrorListener implements ANTLRErrorListener<Token> {
  readonly errors: ApexParseError[] = [];
  syntaxError<T extends Token>(
    _recognizer: Recognizer<T, ATNSimulator>,
    _offendingSymbol: T | undefined,
    line: number,
    charPositionInLine: number,
    msg: string,
    _e: RecognitionException | undefined
  ): void {
    this.errors.push({ line, column: charPositionInLine, message: msg });
  }
}

function textOf(ctx: { text?: string } | null | undefined): string {
  return (ctx?.text ?? "").trim();
}

function modifiersOf(declCtx: { modifier?: () => Array<{ text: string; annotation?: () => unknown }> | undefined } | null | undefined): {
  modifiers: string[];
  annotations: string[];
} {
  const modifiers: string[] = [];
  const annotations: string[] = [];
  const list = declCtx?.modifier?.() ?? [];
  for (const m of list as Array<{ text: string; annotation?: () => { text: string } | undefined }>) {
    const ann = m.annotation?.();
    if (ann) {
      const t = ann.text ?? "";
      annotations.push(t.startsWith("@") ? t : `@${t}`);
    } else {
      modifiers.push(m.text);
    }
  }
  return { modifiers, annotations };
}

function parametersOf(methCtx: any): ApexParameter[] {
  const params: ApexParameter[] = [];
  const formalParams = methCtx?.formalParameters?.();
  const list = formalParams?.formalParameterList?.();
  if (!list) return params;
  const items = list.formalParameter?.() ?? [];
  for (const p of items) {
    params.push({
      name: textOf(p.id?.()),
      type: textOf(p.typeRef?.())
    });
  }
  return params;
}

function extractClassMembers(classBodyCtx: any): {
  methods: ApexMethod[];
  fields: ApexField[];
  properties: ApexProperty[];
  innerTypes: ApexInnerSummary[];
} {
  const methods: ApexMethod[] = [];
  const fields: ApexField[] = [];
  const properties: ApexProperty[] = [];
  const innerTypes: ApexInnerSummary[] = [];
  const decls = classBodyCtx?.classBodyDeclaration?.() ?? [];
  for (const d of decls) {
    const md = d.memberDeclaration?.();
    if (!md) continue;
    const { modifiers, annotations } = modifiersOf(d);

    const methodCtx = md.methodDeclaration?.();
    if (methodCtx) {
      methods.push({
        name: textOf(methodCtx.id?.()),
        returnType: textOf(methodCtx.typeRef?.()) || "void",
        modifiers,
        annotations,
        parameters: parametersOf(methodCtx)
      });
      continue;
    }

    const constructorCtx = md.constructorDeclaration?.();
    if (constructorCtx) {
      methods.push({
        name: textOf(constructorCtx.qualifiedName?.()),
        returnType: "<constructor>",
        modifiers,
        annotations,
        parameters: parametersOf(constructorCtx)
      });
      continue;
    }

    const fieldCtx = md.fieldDeclaration?.();
    if (fieldCtx) {
      const type = textOf(fieldCtx.typeRef?.());
      const declarators = fieldCtx.variableDeclarators?.()?.variableDeclarator?.() ?? [];
      for (const v of declarators) {
        fields.push({
          name: textOf(v.id?.()),
          type,
          modifiers,
          annotations
        });
      }
      continue;
    }

    const propCtx = md.propertyDeclaration?.();
    if (propCtx) {
      properties.push({
        name: textOf(propCtx.id?.()),
        type: textOf(propCtx.typeRef?.()),
        modifiers,
        annotations
      });
      continue;
    }

    const innerClass = md.classDeclaration?.();
    if (innerClass) {
      innerTypes.push({ kind: "class", name: textOf(innerClass.id?.()) });
      continue;
    }
    const innerInterface = md.interfaceDeclaration?.();
    if (innerInterface) {
      innerTypes.push({ kind: "interface", name: textOf(innerInterface.id?.()) });
      continue;
    }
    const innerEnum = md.enumDeclaration?.();
    if (innerEnum) {
      innerTypes.push({ kind: "enum", name: textOf(innerEnum.id?.()) });
    }
  }
  return { methods, fields, properties, innerTypes };
}

function summarizeClass(classCtx: any, topModifiers: string[], topAnnotations: string[]): ApexUnitSummary {
  const name = textOf(classCtx?.id?.());
  const superType = textOf(classCtx?.typeRef?.()) || undefined;
  const implementsCtx = classCtx?.typeList?.();
  const implementsTypes: string[] = [];
  if (implementsCtx) {
    const refs = implementsCtx.typeRef?.() ?? [];
    for (const r of refs) implementsTypes.push(textOf(r));
  }
  const body = classCtx?.classBody?.();
  const members = extractClassMembers(body);
  return {
    kind: "class",
    name,
    ...(superType ? { superType } : {}),
    implementsTypes,
    modifiers: topModifiers,
    annotations: topAnnotations,
    ...members
  };
}

function summarizeInterface(intCtx: any, topModifiers: string[], topAnnotations: string[]): ApexUnitSummary {
  const name = textOf(intCtx?.id?.());
  const extendsCtx = intCtx?.typeList?.();
  const implementsTypes: string[] = [];
  if (extendsCtx) {
    const refs = extendsCtx.typeRef?.() ?? [];
    for (const r of refs) implementsTypes.push(textOf(r));
  }
  const body = intCtx?.interfaceBody?.();
  const methods: ApexMethod[] = [];
  const decls = body?.interfaceMethodDeclaration?.() ?? [];
  for (const m of decls) {
    methods.push({
      name: textOf(m.id?.()),
      returnType: textOf(m.typeRef?.()) || "void",
      modifiers: [],
      annotations: [],
      parameters: parametersOf(m)
    });
  }
  return {
    kind: "interface",
    name,
    implementsTypes,
    modifiers: topModifiers,
    annotations: topAnnotations,
    methods,
    fields: [],
    properties: [],
    innerTypes: []
  };
}

function summarizeEnum(enumCtx: any, topModifiers: string[], topAnnotations: string[]): ApexUnitSummary {
  const name = textOf(enumCtx?.id?.());
  return {
    kind: "enum",
    name,
    implementsTypes: [],
    modifiers: topModifiers,
    annotations: topAnnotations,
    methods: [],
    fields: [],
    properties: [],
    innerTypes: []
  };
}

function summarizeTrigger(triggerCtx: TriggerUnitContext): ApexUnitSummary {
  const ids = (triggerCtx as any).id?.() ?? [];
  const name = textOf(ids[0]);
  const sobject = textOf(ids[1]);
  const cases = (triggerCtx as any).triggerCase?.() ?? [];
  const events: string[] = [];
  for (const c of cases) {
    // each triggerCase = "before|after" "insert|update|delete|undelete"
    events.push(c.text.replace(/\s+/g, " ").trim());
  }
  return {
    kind: "trigger",
    name,
    implementsTypes: [],
    modifiers: [],
    annotations: [],
    methods: [],
    fields: [],
    properties: [],
    innerTypes: [],
    triggerEvents: events,
    triggerObject: sobject
  };
}

function countSoqlAndDml(source: string): { soqlCount: number; dmlCount: number } {
  // 文字列リテラル / 単行コメント / ブロックコメントを除去
  const stripped = source
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const soql = stripped.match(/\[\s*select\b[\s\S]*?\]/gi);
  const dml = stripped.match(/\b(insert|update|delete|upsert|merge|undelete)\s+[A-Za-z_]/gi);
  return {
    soqlCount: soql ? soql.length : 0,
    dmlCount: dml ? dml.length : 0
  };
}

function buildParser(source: string): { parser: ApexParser; listener: CollectingErrorListener } {
  const cs = CharStreams.fromString(source);
  const lexer = new ApexLexer(cs);
  const lexerListener = new CollectingErrorListener();
  lexer.removeErrorListeners();
  lexer.addErrorListener(lexerListener as unknown as ANTLRErrorListener<number>);
  const tokens = new CommonTokenStream(lexer);
  const parser = new ApexParser(tokens);
  const listener = new CollectingErrorListener();
  parser.removeErrorListeners();
  parser.addErrorListener(listener);
  // collect lexer errors into the same listener
  for (const e of lexerListener.errors) listener.errors.push(e);
  return { parser, listener };
}

/**
 * Apex ソース全体を解析する。class / interface / enum / trigger を判別。
 */
export function analyzeApexSource(source: string): ApexAnalysis {
  const errors: ApexParseError[] = [];
  const units: ApexUnitSummary[] = [];

  const isTrigger = /^\s*trigger\s+/i.test(source);
  const { parser, listener } = buildParser(source);

  try {
    if (isTrigger) {
      const tree = parser.triggerUnit();
      units.push(summarizeTrigger(tree));
    } else {
      const tree: CompilationUnitContext = parser.compilationUnit();
      const td: any = tree.typeDeclaration?.();
      if (td) {
        const { modifiers, annotations } = modifiersOf(td);
        if (td.classDeclaration?.()) {
          units.push(summarizeClass(td.classDeclaration(), modifiers, annotations));
        } else if (td.interfaceDeclaration?.()) {
          units.push(summarizeInterface(td.interfaceDeclaration(), modifiers, annotations));
        } else if (td.enumDeclaration?.()) {
          units.push(summarizeEnum(td.enumDeclaration(), modifiers, annotations));
        }
      }
    }
  } catch (err) {
    errors.push({
      line: 0,
      column: 0,
      message: `parse failed: ${(err as Error)?.message ?? String(err)}`
    });
  }

  for (const e of listener.errors) errors.push(e);
  const { soqlCount, dmlCount } = countSoqlAndDml(source);
  return { units, errors, soqlCount, dmlCount };
}
