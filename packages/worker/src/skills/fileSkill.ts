/**
 * 文件处理 Skill
 *
 * 处理文本类文件（txt, md, csv, json, 代码文件等）
 * 集成了两种 Token 节省策略：
 *   1. 代码压缩：只保留函数签名、类定义等关键结构
 *   2. RAG 检索：根据用户问题智能选择相关代码片段
 *
 * 对于大文件（>100K tokens），采用 Map-Reduce 风格的分块处理
 */
import type {
  Skill,
  SkillInput,
  SkillContext,
  SkillStreamChunk,
  Message,
  ResolvedFileContent,
} from "../types";
import { logger } from "../utils/logger";
import {
  estimateTokens,
  splitByTokens,
  addContextToChunks,
} from "../utils/chunker";
import { compressCode, type CompressResult } from "../utils/codeCompressor";
import {
  retrieveRelevantCode,
  formatRetrievedCode,
  detectLanguage,
} from "../utils/ragRetriever";
import { getUploadedFileContent } from "../utils/uploadedFileStorage";
import {
  buildCompressedCodeSection,
  buildResolvedFileSection,
  createChunkSummaryMessages,
  createLargeFileAnswerMessages,
  createMixedFileMessages,
  createRagMessages,
  createSmallFileMessages,
  isCodeFile,
  isSupportedTextFile,
  MAX_TOKEN_THRESHOLD,
  resolveFileUserQuestion,
  selectFileTextExecutor,
} from "./fileSkillSupport";

export const fileSkill: Skill = {
  name: "file-chat",
  type: "text", // 最终还是文本对话
  description: "处理文本文件对话（txt, md, csv, json, 代码文件等），支持代码压缩和智能检索",

  async *execute(
    input: SkillInput,
    context: SkillContext,
  ): AsyncIterable<SkillStreamChunk> {
    const { files = [], messages } = input;

    logger.info("Processing files in fileSkill", { fileCount: files.length });

    const resolvedFiles = await Promise.all(
      files.map((file) => getUploadedFileContent(context.env, file))
    );

    // 调试：打印文件信息
    for (const file of resolvedFiles) {
      logger.info("File details in fileSkill", {
        name: file.fileName,
        contentLength: file.content?.length || 0,
        mimeType: file.mimeType,
        size: file.size,
        estimatedTokens: estimateTokens(file.content || ""),
        isCodeFile: isCodeFile(file.fileName),
      });
    }

    const userQuestion = resolveFileUserQuestion(messages);

    // 判断是否所有文件都是代码文件
    const allCodeFiles = resolvedFiles.length > 0 && resolvedFiles.every(f => isCodeFile(f.fileName));
    const hasCodeFiles = resolvedFiles.some(f => isCodeFile(f.fileName));

    logger.info("File type analysis", {
      allCodeFiles,
      hasCodeFiles,
      fileTypes: resolvedFiles.map(f => ({ name: f.fileName, isCode: isCodeFile(f.fileName) })),
    });

    // 处理策略选择
    if (hasCodeFiles && allCodeFiles) {
      // 全是代码文件：使用 RAG 检索
      yield* processCodeFilesWithRAG(resolvedFiles, userQuestion, input, context);
    } else if (hasCodeFiles) {
      // 混合文件：代码用压缩，其他用原内容
      yield* processMixedFiles(resolvedFiles, userQuestion, input, context);
    } else {
      // 纯文本文件：使用原有分块策略
      const allFileContents = resolvedFiles
        .map(buildResolvedFileSection)
        .join("\n\n");

      const totalTokens = estimateTokens(allFileContents);

      logger.info("File token estimation", {
        totalTokens,
        threshold: MAX_TOKEN_THRESHOLD,
        needsChunking: totalTokens > MAX_TOKEN_THRESHOLD,
      });

      if (totalTokens <= MAX_TOKEN_THRESHOLD) {
        yield* processSmallFiles(allFileContents, userQuestion, input, context);
      } else {
        yield* processLargeFiles(
          resolvedFiles,
          allFileContents,
          userQuestion,
          input,
          context,
        );
      }
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
  const textExecutor = selectFileTextExecutor(input, context);
  const enhancedMessages = createSmallFileMessages(fileContents, userQuestion);

  // 复用 glmSkill 进行对话
  const textInput = { ...input, messages: enhancedMessages, model: textExecutor.model };
  yield* textExecutor.execute(textInput, context);
}

/**
 * 处理大文件（> MAX_TOKEN_THRESHOLD）
 * 采用 Map-Reduce 风格的分块处理
 */
async function* processLargeFiles(
  files: ResolvedFileContent[],
  fileContents: string,
  userQuestion: string,
  input: SkillInput,
  context: SkillContext,
): AsyncIterable<SkillStreamChunk> {
  const textExecutor = selectFileTextExecutor(input, context);
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

  const finalMessages = createLargeFileAnswerMessages(summaries, userQuestion);

  const textInput = { ...input, messages: finalMessages, model: textExecutor.model };
  yield* textExecutor.execute(textInput, context);

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
  const textExecutor = selectFileTextExecutor(input, context);
  logger.info(`Extracting summary for chunk ${chunkIndex}/${totalChunks}`);

  const messages = createChunkSummaryMessages(chunk);

  const textInput = { ...input, messages, maxTokens: 2000, model: textExecutor.model };

  // 收集流式响应
  let summary = "";
  for await (const chunk of textExecutor.execute(textInput, context)) {
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

// ==================== 新增：代码文件 RAG 检索处理 ====================

/**
 * 使用 RAG 检索处理代码文件
 * 根据用户问题智能选择相关代码片段
 */
async function* processCodeFilesWithRAG(
  files: ResolvedFileContent[],
  userQuestion: string,
  input: SkillInput,
  context: SkillContext,
): AsyncIterable<SkillStreamChunk> {
  const textExecutor = selectFileTextExecutor(input, context);
  yield {
    type: "progress",
    progress: {
      message: "正在使用智能检索分析代码...",
      current: 0,
      total: 2,
    },
  };

  const allRetrievedCode: string[] = [];
  let totalOriginalTokens = 0;
  let totalRetrievedTokens = 0;

  for (const file of files) {
    const language = detectLanguage(file.fileName);
    const originalTokens = estimateTokens(file.content || "");
    totalOriginalTokens += originalTokens;

    logger.info("RAG retrieval for code file", {
      filename: file.fileName,
      language,
      originalTokens,
      query: userQuestion.substring(0, 100),
    });

    // 使用 RAG 检索
    const retrievalResult = retrieveRelevantCode(
      file.content || "",
      userQuestion,
      language,
      {
        maxSnippets: 8,
        contextLines: 15,
        minRelevance: 0.1,
        includeImports: true,
        includeComments: false,
      }
    );

    const formattedCode = formatRetrievedCode(retrievalResult);
    const retrievedTokens = estimateTokens(formattedCode);
    totalRetrievedTokens += retrievedTokens;

    // 添加文件头
    const fileHeader = `\n// ========== 文件: ${file.fileName} (${language}) ==========`;
    allRetrievedCode.push(fileHeader + formattedCode);

    logger.info("RAG retrieval result", {
      filename: file.fileName,
      extractedKeywords: retrievalResult.extractedKeywords,
      matchedSnippets: retrievalResult.matchedSnippets.length,
      coverageRatio: retrievalResult.coverageRatio,
      originalTokens,
      retrievedTokens,
      reductionRatio: 1 - (retrievedTokens / originalTokens),
    });
  }

  yield {
    type: "progress",
    progress: {
      message: `已检索 ${files.length} 个代码文件`,
      current: 1,
      total: 2,
    },
  };

  // 构建消息
  const codeContent = allRetrievedCode.join('\n\n');
  const reductionRatio = 1 - (totalRetrievedTokens / totalOriginalTokens);

  const messages = createRagMessages(codeContent, userQuestion, {
    totalOriginalTokens,
    totalProcessedTokens: totalRetrievedTokens,
    reductionRatio,
  });

  logger.info("RAG processing summary", {
    fileCount: files.length,
    totalOriginalTokens,
    totalRetrievedTokens,
    totalSaved: totalOriginalTokens - totalRetrievedTokens,
    reductionRatio: reductionRatio,
  });

  const textInput = { ...input, messages, model: textExecutor.model };
  yield* textExecutor.execute(textInput, context);
}

/**
 * 处理混合文件（代码 + 文本）
 * 代码文件使用压缩，文本文件保持原样
 */
async function* processMixedFiles(
  files: ResolvedFileContent[],
  userQuestion: string,
  input: SkillInput,
  context: SkillContext,
): AsyncIterable<SkillStreamChunk> {
  const textExecutor = selectFileTextExecutor(input, context);
  yield {
    type: "progress",
    progress: {
      message: "正在处理混合文件类型...",
      current: 0,
      total: 2,
    },
  };

  const allFileContents: string[] = [];
  let totalOriginalTokens = 0;
  let totalProcessedTokens = 0;

  for (const file of files) {
    const ext = file.fileName.split(".").pop() || "";
    const originalTokens = estimateTokens(file.content || "");
    totalOriginalTokens += originalTokens;

    if (isCodeFile(file.fileName)) {
      // 代码文件：使用压缩
      const language = detectLanguage(file.fileName);
      const compressResult = compressCode(file.content || "", language);

      allFileContents.push(buildCompressedCodeSection(file, language, compressResult));

      totalProcessedTokens += compressResult.stats.compressedTokens;

      logger.info("Code compression result", {
        filename: file.fileName,
        language,
        originalTokens: compressResult.stats.originalTokens,
        compressedTokens: compressResult.stats.compressedTokens,
        reductionRatio: compressResult.stats.reductionRatio,
        functionsFound: compressResult.stats.functionsFound,
        classesFound: compressResult.stats.classesFound,
      });
    } else {
      // 非代码文件：保持原样
      allFileContents.push(buildResolvedFileSection(file));

      totalProcessedTokens += originalTokens;
    }
  }

  const fileContents = allFileContents.join("\n\n");
  const reductionRatio = 1 - (totalProcessedTokens / totalOriginalTokens);

  // 估算总 token 数
  const totalTokens = estimateTokens(fileContents);

  yield {
    type: "progress",
    progress: {
      message: "生成回答中...",
      current: 1,
      total: 2,
    },
  };

  logger.info("Mixed files processing", {
    codeFileCount: files.filter(f => isCodeFile(f.fileName)).length,
    textFileCount: files.filter(f => !isCodeFile(f.fileName)).length,
    totalOriginalTokens,
    totalProcessedTokens,
    reductionRatio,
  });

  // 构建消息
  const messages = createMixedFileMessages(fileContents, userQuestion, {
    totalOriginalTokens,
    totalProcessedTokens,
    reductionRatio,
  });

  // 检查是否需要分块处理
  if (totalTokens > MAX_TOKEN_THRESHOLD) {
    yield* processLargeFiles(
      files,
      fileContents,
      userQuestion,
      input,
      context,
    );
  } else {
    const textInput = { ...input, messages, model: textExecutor.model };
    yield* textExecutor.execute(textInput, context);
  }
}

export { isSupportedTextFile } from "./fileSkillSupport";
