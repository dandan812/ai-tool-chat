/**
 * 文件处理 Skill
 *
 * 这个 Skill 现在只负责“总分流”：
 * - 全代码文件：走代码检索
 * - 混合文件：代码压缩 + 文本保留
 * - 纯文本文件：小文件直答 / 检索优先 / 必要时摘要回退
 *
 * 之所以把具体执行细节拆出去，是因为 fileSkill 最难理解的地方不是某个单独算法，
 * 而是“面对不同文件类型和不同体量时，到底为什么会选这条路”。
 */
import type {
  Skill,
  SkillContext,
  SkillInput,
  SkillStreamChunk,
} from "../types";
import { estimateTokens } from "../utils/chunker";
import { logger } from "../utils/logger";
import { getUploadedFileContent } from "../utils/uploadedFileStorage";
import {
  buildResolvedFileSection,
  isCodeFile,
  MAX_TOKEN_THRESHOLD,
  resolveFileUserQuestion,
  shouldPreferDirectFileAnswer,
  shouldPreferGlobalSummary,
} from "./fileSkillSupport";
import {
  processSmallFiles,
  processTextFilesWithRetrieval,
} from './fileSkillTextProcessing';
import {
  processCodeFilesWithRAG,
  processMixedFiles,
} from './fileSkillCodeProcessing';

export const fileSkill: Skill = {
  name: "file-chat",
  type: "text",
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
      files.map((file) => getUploadedFileContent(context.env, file)),
    );

    for (const file of resolvedFiles) {
      logger.info("File details in fileSkill", {
        route: '/chat',
        requestType: 'file_analysis',
        taskId: context.taskId,
        skill: 'file-chat',
        name: file.fileName,
        contentLength: file.content?.length || 0,
        mimeType: file.mimeType,
        size: file.size,
        estimatedTokens: estimateTokens(file.content || ""),
        isCodeFile: isCodeFile(file.fileName),
      });
    }

    const userQuestion = resolveFileUserQuestion(messages);
    const allCodeFiles = resolvedFiles.length > 0 && resolvedFiles.every((file) => isCodeFile(file.fileName));
    const hasCodeFiles = resolvedFiles.some((file) => isCodeFile(file.fileName));

    logger.info("File type analysis", {
      route: '/chat',
      requestType: 'file_analysis',
      taskId: context.taskId,
      skill: 'file-chat',
      allCodeFiles,
      hasCodeFiles,
      fileTypes: resolvedFiles.map((file) => ({
        name: file.fileName,
        isCode: isCodeFile(file.fileName),
      })),
    });

    if (hasCodeFiles && allCodeFiles) {
      yield* processCodeFilesWithRAG(resolvedFiles, userQuestion, input, context);
      return;
    }

    if (hasCodeFiles) {
      yield* processMixedFiles(resolvedFiles, userQuestion, input, context);
      return;
    }

    /**
     * 纯文本路径是文件分析里最昂贵、也最容易失控的一条线。
     * 这里先决定“是否值得全文直答”，再决定“是否是整体概览问题”，
     * 最后默认走检索优先，避免把大文本重新塞回模型。
     */
    const allFileContents = resolvedFiles
      .map(buildResolvedFileSection)
      .join("\n\n");
    const totalTokens = estimateTokens(allFileContents);

    logger.info("File token estimation", {
      route: '/chat',
      requestType: 'file_analysis',
      taskId: context.taskId,
      skill: 'file-chat',
      totalTokens,
      threshold: MAX_TOKEN_THRESHOLD,
      needsChunking: totalTokens > MAX_TOKEN_THRESHOLD,
    });

    if (shouldPreferDirectFileAnswer(totalTokens, resolvedFiles.length)) {
      yield* processSmallFiles(allFileContents, userQuestion, input, context);
      return;
    }

    const forceOverviewMode = shouldPreferGlobalSummary(userQuestion);
    yield* processTextFilesWithRetrieval(
      resolvedFiles,
      userQuestion,
      input,
      context,
      totalTokens,
      allFileContents,
      forceOverviewMode,
    );
  },
};

export { isSupportedTextFile } from "./fileSkillSupport";
