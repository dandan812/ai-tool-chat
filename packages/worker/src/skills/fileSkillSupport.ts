import type {
  Message,
  ResolvedFileContent,
  Skill,
  SkillContext,
  SkillInput,
} from "../types";
import type { CompressResult } from "../utils/codeCompressor";
import {
  createChunkSummaryMessages,
  createLargeFileAnswerMessages,
  createMixedFileMessages,
  createRagMessages,
  createSmallFileMessages,
  createTextOverviewMessages,
  createTextRetrievalMessages,
  createTextRetrievalNarrowScopeMessage,
} from "../utils/filePromptBuilders";
import { resolveDefaultFileModel } from "../model/defaultModels";
import { getTextModelProviderLabel } from "../model/textModel";
import { textSkill } from "./textSkill";

/**
 * 这些阈值本质上是在平衡三件事：
 * 1. 回答质量
 * 2. token 成本
 * 3. 响应速度
 *
 * 这轮重构保持数值不变，目的是只收口结构，不顺手改策略。
 */
export const MAX_TOKEN_THRESHOLD = 100000;
export const SMALL_FILE_DIRECT_TOKEN_THRESHOLD = 12000;
export const TEXT_RETRIEVAL_CHUNK_SIZE_TOKENS = 3000;
export const TEXT_RETRIEVAL_TOP_K = 8;
export const TEXT_RETRIEVAL_MAX_PROMPT_TOKENS = 32000;
export const TEXT_RETRIEVAL_MIN_RELEVANCE = 0.12;
export const TEXT_RETRIEVAL_MIN_SELECTED_CHUNKS = 2;

const SUMMARY_REQUEST_PATTERN = /(整体|全文|全篇|整体结构|全文概览|整体概览|总结整[份个]文件|总结全文|通读|概述|梳理|分析一下|分析下|介绍一下|主要讲|讲了什么|说了什么|内容是什么|overview|overall|summary|summari[sz]e)/i;

const CODE_EXTENSIONS = [
  "js", "jsx", "mjs",
  "ts", "tsx",
  "py",
  "java",
  "go",
  "rs",
  "c", "cpp", "cc", "h", "hpp",
  "cs",
  "php",
  "rb",
  "swift",
  "kt",
  "scala",
  "dart",
  "lua",
  "r",
  "sql",
  "sh", "bash",
];

const SUPPORTED_TEXT_EXTENSIONS = [
  "txt",
  "md",
  "markdown",
  "csv",
  "json",
  "xml",
  "yaml",
  "yml",
  "js",
  "ts",
  "jsx",
  "tsx",
  "py",
  "java",
  "c",
  "cpp",
  "h",
  "hpp",
  "html",
  "css",
  "scss",
  "less",
  "go",
  "rs",
  "rb",
  "php",
  "swift",
  "kt",
  "sql",
  "sh",
  "bash",
  "ps1",
  "log",
  "conf",
  "ini",
  "env",
];

export interface TextExecutorSelection {
  execute: Skill["execute"];
  model: string;
}

function getFileExtension(filename: string): string {
  return filename.split(".").pop() || "";
}

/**
 * 文件分析链路最终仍然要落回“某个文本 Skill”去执行。
 * 保留这一层映射，是为了让 fileSkill 不直接依赖底层 provider 细节。
 */
function createTextExecutor(model: string): TextExecutorSelection {
  return {
    // 文件分析最终统一回到百炼文本链路，避免这里再分叉到历史上的独立供应商实现。
    execute: textSkill.execute,
    model,
  };
}

export function isCodeFile(filename: string): boolean {
  return CODE_EXTENSIONS.includes(getFileExtension(filename).toLowerCase());
}

export function isSupportedTextFile(filename: string): boolean {
  return SUPPORTED_TEXT_EXTENSIONS.includes(getFileExtension(filename).toLowerCase());
}

export function resolveFileUserQuestion(messages: Message[]): string {
  const lastUserMsg = [...messages].reverse().find((message) => message.role === "user");
  return lastUserMsg?.content || "请分析这些文件";
}

export function buildResolvedFileSection(file: ResolvedFileContent): string {
  const ext = getFileExtension(file.fileName);
  return `### 文件: ${file.fileName}\n\`\`\`${ext}\n${file.content}\n\`\`\``;
}

export function buildCompressedCodeSection(
  file: ResolvedFileContent,
  language: string,
  compressResult: CompressResult,
): string {
  const ext = getFileExtension(file.fileName);
  return (
    `### 代码文件: ${file.fileName} (${language})\n` +
    `// Token 节省: ${(compressResult.stats.reductionRatio * 100).toFixed(1)}% ` +
    `(${compressResult.stats.originalTokens} -> ${compressResult.stats.compressedTokens} tokens)\n` +
    `\`\`\`${ext}\n${compressResult.compressedCode}\n\`\`\``
  );
}

export function selectFileTextExecutor(
  input: SkillInput,
  context: SkillContext,
): TextExecutorSelection {
  const requestedModel = typeof input.model === "string" ? input.model : "";
  const requestedProvider = requestedModel ? getTextModelProviderLabel(requestedModel) : "文本";

  if (requestedModel && requestedProvider !== "文本") {
    return createTextExecutor(requestedModel);
  }

  return createTextExecutor(resolveDefaultFileModel(context.env));
}

/**
 * 小文件直接回答是最低成本路径，但只有在文件少且总体 token 很低时才值得。
 * 否则即使模型能吃下，也会拖慢首轮响应，并让后续多轮问答重复付费。
 */
export function shouldPreferDirectFileAnswer(
  totalTokens: number,
  fileCount: number,
): boolean {
  return fileCount <= 2 && totalTokens <= SMALL_FILE_DIRECT_TOKEN_THRESHOLD;
}

export function shouldPreferGlobalSummary(userQuestion: string): boolean {
  return SUMMARY_REQUEST_PATTERN.test(userQuestion);
}

/**
 * “检索不足时是否回退到全文摘要”是成本和完整性之间最关键的边界。
 * 只有文件总体仍在安全预算内时，才允许回退到全文或分块摘要。
 */
export function shouldFallbackToFullSummary(
  totalTokens: number,
  selectedChunkCount: number,
  insufficient: boolean,
): boolean {
  if (selectedChunkCount === 0) {
    return totalTokens <= MAX_TOKEN_THRESHOLD;
  }

  if (!insufficient) {
    return false;
  }

  return totalTokens <= MAX_TOKEN_THRESHOLD;
}

export {
  createChunkSummaryMessages,
  createLargeFileAnswerMessages,
  createMixedFileMessages,
  createRagMessages,
  createSmallFileMessages,
  createTextOverviewMessages,
  createTextRetrievalMessages,
  createTextRetrievalNarrowScopeMessage,
};
