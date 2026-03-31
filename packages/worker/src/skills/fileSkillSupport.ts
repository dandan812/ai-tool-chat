import type {
  Message,
  ResolvedFileContent,
  Skill,
  SkillContext,
  SkillInput,
} from "../types";
import type { CompressResult } from "../utils/codeCompressor";
import { getTextModelProviderLabel, resolveDefaultTextModel } from "../utils/textModel";
import { glmSkill } from "./glmSkill";
import { textSkill } from "./textSkill";

/**
 * 最大 token 阈值，超过此值则分块处理。
 * 仍然沿用现有安全阈值，避免改变行为。
 */
export const MAX_TOKEN_THRESHOLD = 100000;
export const SMALL_FILE_DIRECT_TOKEN_THRESHOLD = 12000;
export const TEXT_RETRIEVAL_CHUNK_SIZE_TOKENS = 3000;
export const TEXT_RETRIEVAL_TOP_K = 8;
export const TEXT_RETRIEVAL_MAX_PROMPT_TOKENS = 32000;
export const TEXT_RETRIEVAL_MIN_RELEVANCE = 0.12;
export const TEXT_RETRIEVAL_MIN_SELECTED_CHUNKS = 2;

const SUMMARY_REQUEST_PATTERN = /(整体|全文|全篇|整体结构|全文概览|整体概览|总结整[份个]文件|总结全文|通读|概述|梳理|分析一下|分析下|介绍一下|主要讲|讲了什么|说了什么|内容是什么|overview|overall|summary|summari[sz]e)/i;

/**
 * 支持的代码文件扩展名。
 */
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

/**
 * 支持的文本文件扩展名。
 */
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

/**
 * 分块摘要提示词。
 */
const CHUNK_SUMMARY_PROMPT = `请分析以下文件片段，提取其核心内容和结构。返回格式：
1. 主要内容/功能概述
2. 关键概念/术语
3. 重要数据/配置项

文件片段：`;

interface TokenSummary {
  totalOriginalTokens: number;
  totalProcessedTokens: number;
  reductionRatio: number;
}

interface TextRetrievalSummary extends TokenSummary {
  selectedChunkCount: number;
  budgetExceeded: boolean;
}

export interface TextExecutorSelection {
  execute: Skill["execute"];
  model: string;
}

function getFileExtension(filename: string): string {
  return filename.split(".").pop() || "";
}

function createTextExecutor(model: string): TextExecutorSelection {
  return {
    execute: getTextModelProviderLabel(model) === "GLM" ? glmSkill.execute : textSkill.execute,
    model,
  };
}

function buildFinalAnswerPrompt(summaries: string, userQuestion: string): string {
  return `我有一个大文件，已经分块分析。以下是各分块的摘要：

${summaries}

用户的问题是：${userQuestion}

请基于以上摘要回答用户问题。`;
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

  return createTextExecutor(resolveDefaultTextModel(context.env));
}

export function createSmallFileMessages(fileContents: string, userQuestion: string): Message[] {
  return [
    {
      role: "system",
      content:
        "你是一个文件分析助手。用户会上传一些文本文件，请根据文件内容回答用户的问题。",
    },
    {
      role: "user",
      content: `以下是我上传的文件内容：\n\n${fileContents}\n\n我的问题是：${userQuestion}`,
    },
  ];
}

export function shouldPreferDirectFileAnswer(
  totalTokens: number,
  fileCount: number,
): boolean {
  return fileCount <= 2 && totalTokens <= SMALL_FILE_DIRECT_TOKEN_THRESHOLD;
}

export function shouldPreferGlobalSummary(userQuestion: string): boolean {
  return SUMMARY_REQUEST_PATTERN.test(userQuestion);
}

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

export function createTextRetrievalMessages(
  retrievedContent: string,
  userQuestion: string,
  summary: TextRetrievalSummary,
): Message[] {
  const savedTokens = Math.max(summary.totalOriginalTokens - summary.totalProcessedTokens, 0);

  return [
    {
      role: "system",
      content: `你是一个文本文件分析助手。系统已经先对大文件做了检索，只保留了与问题最相关的文本片段。

原始文件大小: ${summary.totalOriginalTokens} tokens
注入模型大小: ${summary.totalProcessedTokens} tokens
节省 Token: ${savedTokens}
选中片段数: ${summary.selectedChunkCount}
${summary.budgetExceeded ? "由于预算限制，部分相关片段未注入。" : "当前片段已覆盖主要相关内容。"}

请只基于提供的片段回答问题。如果信息不足，请明确说明，并建议用户缩小范围、指定章节、关键词或段落。`,
    },
    {
      role: "user",
      content: `以下是系统检索到的相关文件片段：\n\n${retrievedContent}\n\n我的问题是：${userQuestion}`,
    },
  ];
}

export function createTextOverviewMessages(
  retrievedContent: string,
  userQuestion: string,
  summary: TextRetrievalSummary,
): Message[] {
  return [
    {
      role: "system",
      content: `你是一个文本文件分析助手。用户的问题更偏向整体概览，因此系统没有通读全文，而是从整份文件中抽取了具有代表性的片段。

原始文件大小: ${summary.totalOriginalTokens} tokens
注入模型大小: ${summary.totalProcessedTokens} tokens
代表性片段数: ${summary.selectedChunkCount}
${summary.budgetExceeded ? "片段数量受预算限制，回答时请明确说明可能存在遗漏。" : "片段已覆盖文件的多个位置。"}

请基于这些代表性片段给出整体层面的概览、主题、结构和重点。如果无法确定某个细节，请明确说明该结论只是基于抽样片段。`,
    },
    {
      role: "user",
      content: `以下是从整份文件不同位置抽取的代表性片段：\n\n${retrievedContent}\n\n我的问题是：${userQuestion}`,
    },
  ];
}

export function createTextRetrievalNarrowScopeMessage(
  fileCount: number,
  totalTokens: number,
): string {
  return `这次没有检索到足够相关的文件片段，当前文件总规模约 ${totalTokens} tokens，共 ${fileCount} 个文件。为了避免高成本地通读全文，请把问题缩小到更具体的章节、关键词、人物、时间点或段落。`;
}

export function createLargeFileAnswerMessages(
  summaries: string[],
  userQuestion: string,
): Message[] {
  return [
    {
      role: "system",
      content:
        "你是一个文件分析助手。用户上传了一个大文件，已经分块提取了摘要。请基于这些摘要回答用户问题。",
    },
    {
      role: "user",
      content: buildFinalAnswerPrompt(
        summaries.map((summary, index) => `### 分块 ${index + 1} 摘要:\n${summary}`).join("\n\n"),
        userQuestion,
      ),
    },
  ];
}

export function createChunkSummaryMessages(chunk: string): Message[] {
  return [
    {
      role: "system",
      content:
        "你是一个文件分析助手。用户上传了一个大文件，已经分块。请提取当前分块的核心内容和结构。",
    },
    {
      role: "user",
      content: `${CHUNK_SUMMARY_PROMPT}\n\n${chunk}`,
    },
  ];
}

export function createRagMessages(
  codeContent: string,
  userQuestion: string,
  summary: TokenSummary,
): Message[] {
  return [
    {
      role: "system",
      content: `你是一个代码分析助手。用户上传了代码文件，系统已使用智能检索技术，根据用户问题筛选了最相关的代码片段。

原始代码总大小: ${summary.totalOriginalTokens} tokens
检索后大小: ${summary.totalProcessedTokens} tokens
Token 节省率: ${(summary.reductionRatio * 100).toFixed(1)}%

请基于以下检索到的代码片段回答用户问题。如果信息不足，请告知用户需要查看更多代码。`,
    },
    {
      role: "user",
      content: `${codeContent}\n\n我的问题是：${userQuestion}`,
    },
  ];
}

export function createMixedFileMessages(
  fileContents: string,
  userQuestion: string,
  summary: TokenSummary,
): Message[] {
  return [
    {
      role: "system",
      content: `你是一个文件分析助手。用户上传了混合类型的文件（代码和文本）。

代码文件已使用智能压缩技术，只保留关键结构（函数签名、类定义等）。
原始代码总大小: ${summary.totalOriginalTokens} tokens
处理后大小: ${summary.totalProcessedTokens} tokens
Token 节省率: ${(summary.reductionRatio * 100).toFixed(1)}%

请基于以下文件内容回答用户问题。`,
    },
    {
      role: "user",
      content: `以下是我上传的文件内容：\n\n${fileContents}\n\n我的问题是：${userQuestion}`,
    },
  ];
}
