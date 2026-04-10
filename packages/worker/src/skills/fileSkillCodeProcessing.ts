import type {
  ResolvedFileContent,
  SkillContext,
  SkillInput,
  SkillStreamChunk,
} from '../types';
import { estimateTokens } from '../utils/chunker';
import { compressCode } from '../utils/codeCompressor';
import {
  detectLanguage,
  formatRetrievedCode,
  retrieveRelevantCode,
} from '../utils/ragRetriever';
import { logger } from '../utils/logger';
import {
  createMixedFileMessages,
  createRagMessages,
} from '../utils/filePromptBuilders';
import {
  buildCompressedCodeSection,
  buildResolvedFileSection,
  isCodeFile,
  MAX_TOKEN_THRESHOLD,
  selectFileTextExecutor,
} from './fileSkillSupport';
import { processLargeFiles } from './fileSkillTextProcessing';

/**
 * 代码文件路径和文本文件路径的处理目标完全不同：
 * - 全代码文件：优先保留最相关的代码片段，尽量少把无关实现送进模型
 * - 混合文件：代码压缩，文本原样保留，避免因为单个代码文件拖垮整份上下文
 *
 * 这两条路径都属于 fileSkill 的“代码侧策略”，因此单独放到这里，
 * 让 fileSkill.ts 本身只保留总分流逻辑。
 */
export async function* processCodeFilesWithRAG(
  files: ResolvedFileContent[],
  userQuestion: string,
  input: SkillInput,
  context: SkillContext,
): AsyncIterable<SkillStreamChunk> {
  const textExecutor = selectFileTextExecutor(input, context);

  yield {
    type: 'progress',
    progress: {
      message: '正在使用智能检索分析代码...',
      current: 0,
      total: 2,
    },
  };

  const retrievedSections: string[] = [];
  let totalOriginalTokens = 0;
  let totalRetrievedTokens = 0;

  for (const file of files) {
    const language = detectLanguage(file.fileName);
    const originalTokens = estimateTokens(file.content || '');
    totalOriginalTokens += originalTokens;

    logger.info('RAG retrieval for code file', {
      route: '/chat',
      requestType: 'file_analysis',
      taskId: context.taskId,
      skill: 'file-chat',
      filename: file.fileName,
      language,
      originalTokens,
      query: userQuestion.substring(0, 100),
    });

    const retrievalResult = retrieveRelevantCode(file.content || '', userQuestion, language, {
      maxSnippets: 8,
      contextLines: 15,
      minRelevance: 0.1,
      includeImports: true,
      includeComments: false,
    });

    const formattedCode = formatRetrievedCode(retrievalResult);
    const retrievedTokens = estimateTokens(formattedCode);
    totalRetrievedTokens += retrievedTokens;

    retrievedSections.push(
      `\n// ========== 文件: ${file.fileName} (${language}) ==========${formattedCode}`,
    );

    logger.info('RAG retrieval result', {
      route: '/chat',
      requestType: 'file_analysis',
      taskId: context.taskId,
      skill: 'file-chat',
      filename: file.fileName,
      extractedKeywords: retrievalResult.extractedKeywords,
      matchedSnippets: retrievalResult.matchedSnippets.length,
      coverageRatio: retrievalResult.coverageRatio,
      originalTokens,
      retrievedTokens,
      reductionRatio: 1 - (retrievedTokens / Math.max(originalTokens, 1)),
    });
  }

  yield {
    type: 'progress',
    progress: {
      message: `已检索 ${files.length} 个代码文件`,
      current: 1,
      total: 2,
    },
  };

  const codeContent = retrievedSections.join('\n\n');
  const reductionRatio = 1 - (totalRetrievedTokens / Math.max(totalOriginalTokens, 1));
  const messages = createRagMessages(codeContent, userQuestion, {
    totalOriginalTokens,
    totalProcessedTokens: totalRetrievedTokens,
    reductionRatio,
  });

  logger.info('RAG processing summary', {
    route: '/chat',
    requestType: 'file_analysis',
    taskId: context.taskId,
    skill: 'file-chat',
    fileCount: files.length,
    totalOriginalTokens,
    totalRetrievedTokens,
    totalSaved: totalOriginalTokens - totalRetrievedTokens,
    reductionRatio,
  });

  yield* textExecutor.execute({ ...input, messages, model: textExecutor.model }, context);
}

export async function* processMixedFiles(
  files: ResolvedFileContent[],
  userQuestion: string,
  input: SkillInput,
  context: SkillContext,
): AsyncIterable<SkillStreamChunk> {
  const textExecutor = selectFileTextExecutor(input, context);

  yield {
    type: 'progress',
    progress: {
      message: '正在处理混合文件类型...',
      current: 0,
      total: 2,
    },
  };

  const allFileContents: string[] = [];
  let totalOriginalTokens = 0;
  let totalProcessedTokens = 0;

  for (const file of files) {
    const originalTokens = estimateTokens(file.content || '');
    totalOriginalTokens += originalTokens;

    if (!isCodeFile(file.fileName)) {
      allFileContents.push(buildResolvedFileSection(file));
      totalProcessedTokens += originalTokens;
      continue;
    }

    const language = detectLanguage(file.fileName);
    const compressResult = compressCode(file.content || '', language);
    allFileContents.push(buildCompressedCodeSection(file, language, compressResult));
    totalProcessedTokens += compressResult.stats.compressedTokens;

    logger.info('Code compression result', {
      route: '/chat',
      requestType: 'file_analysis',
      taskId: context.taskId,
      skill: 'file-chat',
      filename: file.fileName,
      language,
      originalTokens: compressResult.stats.originalTokens,
      compressedTokens: compressResult.stats.compressedTokens,
      reductionRatio: compressResult.stats.reductionRatio,
      functionsFound: compressResult.stats.functionsFound,
      classesFound: compressResult.stats.classesFound,
    });
  }

  const fileContents = allFileContents.join('\n\n');
  const totalTokens = estimateTokens(fileContents);
  const reductionRatio = 1 - (totalProcessedTokens / Math.max(totalOriginalTokens, 1));

  yield {
    type: 'progress',
    progress: {
      message: '生成回答中...',
      current: 1,
      total: 2,
    },
  };

  logger.info('Mixed files processing', {
    route: '/chat',
    requestType: 'file_analysis',
    taskId: context.taskId,
    skill: 'file-chat',
    codeFileCount: files.filter((file) => isCodeFile(file.fileName)).length,
    textFileCount: files.filter((file) => !isCodeFile(file.fileName)).length,
    totalOriginalTokens,
    totalProcessedTokens,
    reductionRatio,
  });

  if (totalTokens > MAX_TOKEN_THRESHOLD) {
    yield* processLargeFiles(files, fileContents, userQuestion, input, context);
    return;
  }

  const messages = createMixedFileMessages(fileContents, userQuestion, {
    totalOriginalTokens,
    totalProcessedTokens,
    reductionRatio,
  });

  yield* textExecutor.execute({ ...input, messages, model: textExecutor.model }, context);
}
