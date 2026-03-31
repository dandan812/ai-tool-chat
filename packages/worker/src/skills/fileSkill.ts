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
  ResolvedFileContent,
} from "../types";
import { logger } from "../utils/logger";
import {
  estimateTokens,
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
  createMixedFileMessages,
  createRagMessages,
  isCodeFile,
  isSupportedTextFile,
  MAX_TOKEN_THRESHOLD,
  resolveFileUserQuestion,
  shouldPreferDirectFileAnswer,
  shouldPreferGlobalSummary,
} from "./fileSkillSupport";
import {
  processSmallFiles,
  processLargeFiles,
  processTextFilesWithRetrieval,
} from './fileSkillTextProcessing';

export const fileSkill: Skill = {
  name: "file-chat",
  type: "text", // 最终还是文本对话
  description: "处理文本文件对话（txt, md, csv, json, 代码文件等），支持代码压缩和智能检索",

  async *execute(
    input: SkillInput,
    context: SkillContext,
  ): AsyncIterable<SkillStreamChunk> {
    const { files = [], messages } = input;

    logger.info("Processing files in fileSkill", {
      route: '/chat',
      requestType: 'file_analysis',
      taskId: context.taskId,
      skill: 'file-chat',
      fileCount: files.length,
    });

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
      // 纯文本文件：优先走检索式问答，必要时再回退到全文/分块摘要
      const allFileContents = resolvedFiles
        .map(buildResolvedFileSection)
        .join("\n\n");

      const totalTokens = estimateTokens(allFileContents);

      logger.info("File token estimation", {
        totalTokens,
        threshold: MAX_TOKEN_THRESHOLD,
        needsChunking: totalTokens > MAX_TOKEN_THRESHOLD,
      });

      if (shouldPreferDirectFileAnswer(totalTokens, resolvedFiles.length)) {
        yield* processSmallFiles(allFileContents, userQuestion, input, context);
      } else if (shouldPreferGlobalSummary(userQuestion)) {
        if (totalTokens <= MAX_TOKEN_THRESHOLD) {
          yield* processSmallFiles(allFileContents, userQuestion, input, context);
        } else {
          yield* processTextFilesWithRetrieval(
            resolvedFiles,
            userQuestion,
            input,
            context,
            totalTokens,
            allFileContents,
            true,
          );
        }
      } else {
        yield* processTextFilesWithRetrieval(
          resolvedFiles,
          userQuestion,
          input,
          context,
          totalTokens,
          allFileContents,
          false,
        );
      }
    }
  },
};

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
