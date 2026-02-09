/**
 * 文件处理 Skill
 *
 * 处理文本类文件（txt, md, csv, json, 代码文件等）
 * 对于大文件（>100K tokens），采用 Map-Reduce 风格的分块处理：
 *   1. 将文件分成多个小块
 *   2. 并行提取每个分块的摘要
 *   3. 合并所有摘要，生成最终答案
 *
 * 注意：DeepSeek 本身不直接支持文件上传，
 * 这个 Skill 是将文件内容作为文本插入到对话中
 */
import type {
  Skill,
  SkillInput,
  SkillContext,
  SkillStreamChunk,
  Message,
  FileData,
} from "../types";
import { glmSkill } from "./glmSkill";
import { logger } from "../utils/logger";
import {
  estimateTokens,
  splitByTokens,
  addContextToChunks,
} from "../utils/chunker";

/**
 * 最大 token 阈值，超过此值则分块处理
 * DeepSeek 限制为 131,072 tokens，留 30k 余量
 */
const MAX_TOKEN_THRESHOLD = 100000;

/**
 * 分块摘要提示词
 */
const CHUNK_SUMMARY_PROMPT = `请分析以下文件片段，提取其核心内容和结构。返回格式：
1. 主要内容/功能概述
2. 关键概念/术语
3. 重要数据/配置项

文件片段：`;

/**
 * 最终答案生成提示词模板
 */
const FINAL_ANSWER_PROMPT = (
  summaries: string,
  userQuestion: string,
) => `我有一个大文件，已经分块分析。以下是各分块的摘要：

${summaries}

用户的问题是：${userQuestion}

请基于以上摘要回答用户问题。`;

export const fileSkill: Skill = {
  name: "file-chat",
  type: "text", // 最终还是文本对话
  description: "处理文本文件对话（txt, md, csv, json, 代码文件等）",

  async *execute(
    input: SkillInput,
    context: SkillContext,
  ): AsyncIterable<SkillStreamChunk> {
    const { files = [], messages } = input;

    logger.info("Processing files in fileSkill", { fileCount: files.length });

    // 调试：打印文件信息
    for (const file of files) {
      logger.info("File details in fileSkill", {
        name: file.name,
        contentLength: file.content?.length || 0,
        mimeType: file.mimeType,
        size: file.size,
        estimatedTokens: estimateTokens(file.content || ""),
      });
    }

    // 获取最后一条用户消息
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
    const userQuestion = lastUserMsg?.content || "请分析这些文件";

    // 合并所有文件内容
    const allFileContents = files
      .map((file) => {
        const ext = file.name.split(".").pop() || "";
        return `### 文件: ${file.name}\n\`\`\`${ext}\n${file.content}\n\`\`\``;
      })
      .join("\n\n");

    // 估算总 token 数
    const totalTokens = estimateTokens(allFileContents);

    logger.info("File token estimation", {
      totalTokens,
      threshold: MAX_TOKEN_THRESHOLD,
      needsChunking: totalTokens > MAX_TOKEN_THRESHOLD,
    });

    // 判断是否需要分块处理
    if (totalTokens <= MAX_TOKEN_THRESHOLD) {
      // 小文件：直接处理
      yield* processSmallFiles(allFileContents, userQuestion, input, context);
    } else {
      // 大文件：分块处理
      yield* processLargeFiles(
        files,
        allFileContents,
        userQuestion,
        input,
        context,
      );
    }
  },
};

/**
 * 处理小文件（≤ MAX_TOKEN_THRESHOLD）
 */
async function* processSmallFiles(
  fileContents: string,
  userQuestion: string,
  input: SkillInput,
  context: SkillContext,
): AsyncIterable<SkillStreamChunk> {
  // 构建新的消息列表，将文件内容作为上下文
  const enhancedMessages: Message[] = [
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

  // 复用 glmSkill 进行对话
  const textInput = { ...input, messages: enhancedMessages };
  yield* glmSkill.execute(textInput, context);
}

/**
 * 处理大文件（> MAX_TOKEN_THRESHOLD）
 * 采用 Map-Reduce 风格的分块处理
 */
async function* processLargeFiles(
  files: FileData[],
  fileContents: string,
  userQuestion: string,
  input: SkillInput,
  context: SkillContext,
): AsyncIterable<SkillStreamChunk> {
  // 每块的最大 token 数（预留一些余量）
  const maxTokensPerChunk = MAX_TOKEN_THRESHOLD - 20000;

  logger.info("Starting chunked processing", { maxTokensPerChunk });

  // 步骤 1: 分块
  yield {
    type: "progress",
    progress: {
      message: "正在分析文件并分块...",
      current: 0,
      total: 3,
    },
  };

  const rawChunks = splitByTokens(fileContents, maxTokensPerChunk);
  const chunks = addContextToChunks(rawChunks, 50);

  logger.info("File split into chunks", {
    totalChunks: chunks.length,
    totalTokens: estimateTokens(fileContents),
    avgTokensPerChunk: Math.round(estimateTokens(fileContents) / chunks.length),
  });

  // 步骤 2: 并行提取摘要
  yield {
    type: "progress",
    progress: {
      message: `正在处理 ${chunks.length} 个分块...`,
      current: 1,
      total: 3,
    },
  };

  const summaries = await extractChunkSummaries(chunks, input, context);

  logger.info("Chunk summaries extracted", { summaryCount: summaries.length });

  // 步骤 3: 生成最终答案
  yield {
    type: "progress",
    progress: {
      message: "正在生成最终答案...",
      current: 2,
      total: 3,
    },
  };

  const finalPrompt = FINAL_ANSWER_PROMPT(
    summaries.map((s, i) => `### 分块 ${i + 1} 摘要:\n${s}`).join("\n\n"),
    userQuestion,
  );

  const finalMessages: Message[] = [
    {
      role: "system",
      content:
        "你是一个文件分析助手。用户上传了一个大文件，已经分块提取了摘要。请基于这些摘要回答用户问题。",
    },
    {
      role: "user",
      content: finalPrompt,
    },
  ];

  const textInput = { ...input, messages: finalMessages };
  yield* glmSkill.execute(textInput, context);

  logger.info("Large file processing completed");
}

/**
 * 并行提取所有分块的摘要
 * 限制并发数为 3，避免 API 限流
 */
async function extractChunkSummaries(
  chunks: string[],
  input: SkillInput,
  context: SkillContext,
): Promise<string[]> {
  const CONCURRENCY_LIMIT = 3;
  const summaries: string[] = [];

  // 分批处理
  for (let i = 0; i < chunks.length; i += CONCURRENCY_LIMIT) {
    const batch = chunks.slice(i, i + CONCURRENCY_LIMIT);
    const batchResults = await Promise.all(
      batch.map((chunk, batchIndex) =>
        extractSingleChunkSummary(
          chunk,
          i + batchIndex + 1,
          chunks.length,
          input,
          context,
        ),
      ),
    );
    summaries.push(...batchResults);
  }

  return summaries;
}

/**
 * 提取单个分块的摘要
 */
async function extractSingleChunkSummary(
  chunk: string,
  chunkIndex: number,
  totalChunks: number,
  input: SkillInput,
  context: SkillContext,
): Promise<string> {
  logger.info(`Extracting summary for chunk ${chunkIndex}/${totalChunks}`);

  const messages: Message[] = [
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

  const textInput = { ...input, messages, maxTokens: 2000 };

  // 收集流式响应
  let summary = "";
  for await (const chunk of glmSkill.execute(textInput, context)) {
    if (chunk.type === "content") {
      summary += chunk.content;
    } else if (chunk.type === "error") {
      logger.error(`Error in chunk ${chunkIndex}`, { error: chunk.error });
      return `提取失败: ${chunk.error}`;
    }
  }

  logger.info(`Summary extracted for chunk ${chunkIndex}`, {
    summaryLength: summary.length,
  });
  return summary;
}

/**
 * 检查是否是支持的文本文件
 */
export function isSupportedTextFile(filename: string): boolean {
  const supportedExts = [
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

  const ext = filename.split(".").pop()?.toLowerCase() || "";
  return supportedExts.includes(ext);
}
