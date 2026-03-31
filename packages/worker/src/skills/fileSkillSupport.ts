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
