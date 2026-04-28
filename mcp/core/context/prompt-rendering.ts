/**
 * Prompt rendering facade.
 *
 * server.ts holds project-root and markdown-catalog wiring. This module exposes a
 * thin factory that captures those dependencies and returns the legacy
 * `buildChatPrompt` / `buildChatPromptCompat` signatures used by the MCP server
 * boundary. The actual composition lives in `chat-prompt-builder.ts`.
 *
 * TASK-F2: extracted from server.ts to keep the entry file focused on tool
 * registration and lifecycle wiring.
 */
import { buildChatPromptFromContext } from "./chat-prompt-builder.js";

const REVIEW_TOPIC_PATTERN = /レビュー|確認|チェック|監査|review|audit|qa|quality/i;
const EXPLORATION_TOPIC_PATTERN = /調査|分析|原因|探索|investigate|analysis|debug|troubleshoot/i;

export const DEFAULT_MAX_CONTEXT_CHARS = Object.freeze({
  implementation: 8000,
  review: 6000,
  exploration: 12000
});

export function resolveDefaultMaxContextChars(input: {
  topic: string;
  filePaths: string[];
  maxContextChars?: number;
}): number {
  if (input.maxContextChars != null) {
    return input.maxContextChars;
  }

  if (input.filePaths.length > 0 || REVIEW_TOPIC_PATTERN.test(input.topic)) {
    return DEFAULT_MAX_CONTEXT_CHARS.review;
  }

  if (EXPLORATION_TOPIC_PATTERN.test(input.topic)) {
    return DEFAULT_MAX_CONTEXT_CHARS.exploration;
  }

  return DEFAULT_MAX_CONTEXT_CHARS.implementation;
}

export type FindMdFilesRecursiveFn = (dir: string) => string[];
export type ToPosixPathFn = (p: string) => string;
export type TruncateContentFn = (text: string, maxChars: number, label?: string) => string;
export type GetMdFileAsyncFn = (dir: string, name: string) => Promise<string>;

export interface PromptRendererDeps {
  root: string;
  findMdFilesRecursive: FindMdFilesRecursiveFn;
  toPosixPath: ToPosixPathFn;
  truncateContent: TruncateContentFn;
  getMdFileAsync: GetMdFileAsyncFn;
}

export interface PromptRenderer {
  buildChatPrompt(
    topic: string,
    agentNames: string[],
    personaName: string | undefined,
    skillNames: string[],
    filePaths: string[],
    turns: number,
    maxContextChars?: number,
    appendInstruction?: string,
    includeProjectContext?: boolean
  ): Promise<string>;
  buildChatPromptCompat(
    topic: string,
    agentNames: string[],
    personaName?: string,
    skillNames?: string[],
    filePaths?: string[],
    turns?: number,
    maxContextChars?: number,
    appendInstruction?: string,
    includeProjectContext?: boolean
  ): Promise<string>;
}

/**
 * Build a prompt-renderer bound to a specific project root and catalog helpers.
 *
 * The legacy positional API (`buildChatPrompt` / `buildChatPromptCompat`) is
 * preserved verbatim so that registered tool handlers can keep their existing
 * call sites untouched.
 */
export function createPromptRenderer(deps: PromptRendererDeps): PromptRenderer {
  const buildChatPrompt: PromptRenderer["buildChatPrompt"] = (
    topic,
    agentNames,
    personaName,
    skillNames,
    filePaths,
    turns,
    maxContextChars,
    appendInstruction,
    includeProjectContext
  ) => {
    const resolvedMaxContextChars = resolveDefaultMaxContextChars({
      topic,
      filePaths,
      maxContextChars
    });

    return buildChatPromptFromContext(
      {
        topic,
        agentNames,
        personaName,
        skillNames,
        filePaths,
        turns,
        maxContextChars: resolvedMaxContextChars,
        appendInstruction,
        includeProjectContext
      },
      {
        root: deps.root,
        findMdFilesRecursive: deps.findMdFilesRecursive,
        toPosixPath: deps.toPosixPath,
        truncateContent: deps.truncateContent,
        getMdFileAsync: deps.getMdFileAsync
      }
    );
  };

  const buildChatPromptCompat: PromptRenderer["buildChatPromptCompat"] = (
    topic,
    agentNames,
    personaName,
    skillNames,
    filePaths,
    turns,
    maxContextChars,
    appendInstruction,
    includeProjectContext
  ) =>
    buildChatPrompt(
      topic,
      agentNames,
      personaName,
      skillNames ?? [],
      filePaths ?? [],
      turns ?? 6,
      maxContextChars,
      appendInstruction,
      includeProjectContext
    );

  return { buildChatPrompt, buildChatPromptCompat };
}
