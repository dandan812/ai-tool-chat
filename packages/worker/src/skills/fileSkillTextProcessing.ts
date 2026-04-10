import type {
  ResolvedFileContent,
  SkillContext,
  SkillInput,
  SkillStreamChunk,
} from '../types'
import { addContextToChunks, estimateTokens, splitByTokens } from '../utils/chunker'
import { logger } from '../utils/logger'
import { ERROR_CODES } from '../utils/observability'
import {
  formatRetrievedText,
  getOrCreateTextRetrievalIndex,
  retrieveOverviewText,
  retrieveRelevantText,
} from '../utils/textRetriever'
import {
  createChunkSummaryMessages,
  createLargeFileAnswerMessages,
  createSmallFileMessages,
  createTextOverviewMessages,
  createTextRetrievalMessages,
  createTextRetrievalNarrowScopeMessage,
} from '../utils/filePromptBuilders'
import {
  MAX_TOKEN_THRESHOLD,
  selectFileTextExecutor,
  shouldFallbackToFullSummary,
  TEXT_RETRIEVAL_CHUNK_SIZE_TOKENS,
  TEXT_RETRIEVAL_MAX_PROMPT_TOKENS,
  TEXT_RETRIEVAL_MIN_RELEVANCE,
  TEXT_RETRIEVAL_TOP_K,
} from './fileSkillSupport'

/**
 * 只有在“文件体量很小、文件数很少”时，才值得直接全文进模型。
 * 这条路径成本最低，但一旦文件变大，就会拖慢首轮响应并放大后续多轮问答成本。
 */
export async function* processSmallFiles(
  fileContents: string,
  userQuestion: string,
  input: SkillInput,
  context: SkillContext,
): AsyncIterable<SkillStreamChunk> {
  const textExecutor = selectFileTextExecutor(input, context)
  const enhancedMessages = createSmallFileMessages(fileContents, userQuestion)

  const textInput = { ...input, messages: enhancedMessages, model: textExecutor.model }
  yield* textExecutor.execute(textInput, context)
}

export async function* processLargeFiles(
  _files: ResolvedFileContent[],
  fileContents: string,
  userQuestion: string,
  input: SkillInput,
  context: SkillContext,
): AsyncIterable<SkillStreamChunk> {
  const textExecutor = selectFileTextExecutor(input, context)
  const maxTokensPerChunk = MAX_TOKEN_THRESHOLD - 20000

  logger.info('Starting chunked processing', {
    route: '/chat',
    requestType: 'file_analysis',
    taskId: context.taskId,
    skill: 'file-chat',
    model: textExecutor.model,
    maxTokensPerChunk,
  })

  yield {
    type: 'progress',
    progress: {
      message: '正在分析文件并分块...',
      current: 0,
      total: 3,
    },
  }

  const rawChunks = splitByTokens(fileContents, maxTokensPerChunk)
  const chunks = addContextToChunks(rawChunks, 50)

  logger.info('File split into chunks', {
    route: '/chat',
    requestType: 'file_analysis',
    taskId: context.taskId,
    skill: 'file-chat',
    totalChunks: chunks.length,
    totalTokens: estimateTokens(fileContents),
    avgTokensPerChunk: Math.round(estimateTokens(fileContents) / chunks.length),
  })

  yield {
    type: 'progress',
    progress: {
      message: `正在处理 ${chunks.length} 个分块...`,
      current: 1,
      total: 3,
    },
  }

  const summaries = await extractChunkSummaries(chunks, input, context)

  logger.info('Chunk summaries extracted', {
    route: '/chat',
    requestType: 'file_analysis',
    taskId: context.taskId,
    skill: 'file-chat',
    summaryCount: summaries.length,
  })

  yield {
    type: 'progress',
    progress: {
      message: '正在生成最终答案...',
      current: 2,
      total: 3,
    },
  }

  const finalMessages = createLargeFileAnswerMessages(summaries, userQuestion)
  const textInput = { ...input, messages: finalMessages, model: textExecutor.model }
  yield* textExecutor.execute(textInput, context)

  logger.info('Large file processing completed', {
    route: '/chat',
    requestType: 'file_analysis',
    taskId: context.taskId,
    skill: 'file-chat',
    model: textExecutor.model,
  })
}

export async function* processTextFilesWithRetrieval(
  files: ResolvedFileContent[],
  userQuestion: string,
  input: SkillInput,
  context: SkillContext,
  totalTokens: number,
  allFileContents: string,
  forceOverviewMode = false,
): AsyncIterable<SkillStreamChunk> {
  const textExecutor = selectFileTextExecutor(input, context)

  yield {
    type: 'progress',
    progress: {
      message: '正在建立文本检索索引...',
      current: 0,
      total: 2,
    },
  }

  const indices = await Promise.all(
    files.map((file) =>
      getOrCreateTextRetrievalIndex(context.env, file, TEXT_RETRIEVAL_CHUNK_SIZE_TOKENS),
    ),
  )

  const retrieval = retrieveRelevantText(indices, userQuestion, {
    chunkSizeTokens: TEXT_RETRIEVAL_CHUNK_SIZE_TOKENS,
    topK: TEXT_RETRIEVAL_TOP_K,
    maxPromptTokens: TEXT_RETRIEVAL_MAX_PROMPT_TOKENS,
    minRelevance: TEXT_RETRIEVAL_MIN_RELEVANCE,
  })
  /**
   * 当用户本身就在问“整体内容”，或者检索结果不足但文件又明显偏大时，
   * 直接回退全文摘要会重新把成本抬高，所以这里优先切到“概览模式”：
   * 从文件不同位置抽代表性片段，给出整体轮廓，而不是假装已经通读全文。
   */
  const overviewRetrieval = forceOverviewMode || (retrieval.insufficient && totalTokens > MAX_TOKEN_THRESHOLD)
    ? retrieveOverviewText(indices, userQuestion, {
        topK: TEXT_RETRIEVAL_TOP_K,
        maxPromptTokens: TEXT_RETRIEVAL_MAX_PROMPT_TOKENS,
      })
    : null

  logger.info('Text retrieval summary', {
    route: '/chat',
    requestType: 'file_analysis',
    taskId: context.taskId,
    skill: 'file-chat',
    model: textExecutor.model,
    fileCount: files.length,
    totalTokens,
    totalChunks: retrieval.totalChunks,
    selectedChunks: retrieval.selectedChunks.length,
    selectedTokens: retrieval.selectedTokens,
    coverageRatio: retrieval.coverageRatio,
    budgetExceeded: retrieval.budgetExceeded,
    hasDirectMatch: retrieval.hasDirectMatch,
    insufficient: retrieval.insufficient,
  })

  if (overviewRetrieval && overviewRetrieval.selectedChunks.length > 0) {
    logger.info('Text retrieval switched to overview mode', {
      route: '/chat',
      requestType: 'file_analysis',
      taskId: context.taskId,
      skill: 'file-chat',
      model: textExecutor.model,
      fileCount: files.length,
      totalTokens,
      selectedChunks: overviewRetrieval.selectedChunks.length,
      selectedTokens: overviewRetrieval.selectedTokens,
      forceOverviewMode,
    })

    yield {
      type: 'progress',
      progress: {
        message: '正在按整份文件的代表性片段生成概览...',
        current: 1,
        total: 2,
      },
    }

    const retrievedContent = formatRetrievedText(overviewRetrieval)
    const messages = createTextOverviewMessages(retrievedContent, userQuestion, {
      totalOriginalTokens: overviewRetrieval.totalTokens,
      totalProcessedTokens: overviewRetrieval.selectedTokens,
      reductionRatio: 1 - (overviewRetrieval.selectedTokens / Math.max(overviewRetrieval.totalTokens, 1)),
      selectedChunkCount: overviewRetrieval.selectedChunks.length,
      budgetExceeded: overviewRetrieval.budgetExceeded,
    })

    const textInput = { ...input, messages, model: textExecutor.model }
    yield* textExecutor.execute(textInput, context)
    return
  }

  if (shouldFallbackToFullSummary(totalTokens, retrieval.selectedChunks.length, retrieval.insufficient)) {
    logger.info('Text retrieval fallback to full summary', {
      route: '/chat',
      requestType: 'file_analysis',
      taskId: context.taskId,
      skill: 'file-chat',
      model: textExecutor.model,
      totalTokens,
      selectedChunks: retrieval.selectedChunks.length,
    })

    if (totalTokens <= MAX_TOKEN_THRESHOLD) {
      yield* processSmallFiles(allFileContents, userQuestion, input, context)
      return
    }

    yield* processLargeFiles(files, allFileContents, userQuestion, input, context)
    return
  }

  if (retrieval.selectedChunks.length === 0) {
    logger.warn('Text retrieval requires narrower scope', {
      route: '/chat',
      requestType: 'file_analysis',
      taskId: context.taskId,
      skill: 'file-chat',
      model: textExecutor.model,
      errorCode: ERROR_CODES.FILE_RETRIEVAL_SCOPE_LIMIT,
      totalTokens,
      fileCount: files.length,
    })
    yield {
      type: 'content',
      content: createTextRetrievalNarrowScopeMessage(files.length, totalTokens),
    }
    yield { type: 'complete' }
    return
  }

  yield {
    type: 'progress',
    progress: {
      message: `已检索到 ${retrieval.selectedChunks.length} 个高相关片段`,
      current: 1,
      total: 2,
    },
  }

  const retrievedContent = formatRetrievedText(retrieval)
  const messages = createTextRetrievalMessages(retrievedContent, userQuestion, {
    totalOriginalTokens: retrieval.totalTokens,
    totalProcessedTokens: retrieval.selectedTokens,
    reductionRatio: 1 - (retrieval.selectedTokens / Math.max(retrieval.totalTokens, 1)),
    selectedChunkCount: retrieval.selectedChunks.length,
    budgetExceeded: retrieval.budgetExceeded,
  })

  const textInput = { ...input, messages, model: textExecutor.model }
  yield* textExecutor.execute(textInput, context)
}

async function extractChunkSummaries(
  chunks: string[],
  input: SkillInput,
  context: SkillContext,
): Promise<string[]> {
  /**
   * 这里限制并发不是为了“更快”，而是为了避免大文件摘要时同时打爆上游模型配额，
   * 以及在 Worker 环境里堆出过高的瞬时资源占用。
   */
  const concurrencyLimit = 3
  const summaries: string[] = []

  for (let i = 0; i < chunks.length; i += concurrencyLimit) {
    const batch = chunks.slice(i, i + concurrencyLimit)
    const batchResults = await Promise.all(
      batch.map((chunk, batchIndex) =>
        extractSingleChunkSummary(chunk, i + batchIndex + 1, chunks.length, input, context),
      ),
    )
    summaries.push(...batchResults)
  }

  return summaries
}

async function extractSingleChunkSummary(
  chunk: string,
  chunkIndex: number,
  totalChunks: number,
  input: SkillInput,
  context: SkillContext,
): Promise<string> {
  const textExecutor = selectFileTextExecutor(input, context)
  logger.info(`Extracting summary for chunk ${chunkIndex}/${totalChunks}`, {
    route: '/chat',
    requestType: 'file_analysis',
    taskId: context.taskId,
    skill: 'file-chat',
    model: textExecutor.model,
  })

  const messages = createChunkSummaryMessages(chunk)
  const textInput = { ...input, messages, maxTokens: 2000, model: textExecutor.model }

  let summary = ''
  for await (const streamChunk of textExecutor.execute(textInput, context)) {
    if (streamChunk.type === 'content') {
      summary += streamChunk.content
    } else if (streamChunk.type === 'error') {
      logger.error(`Error in chunk ${chunkIndex}`, {
        route: '/chat',
        requestType: 'file_analysis',
        taskId: context.taskId,
        skill: 'file-chat',
        model: textExecutor.model,
        errorCode: ERROR_CODES.FILE_ANALYSIS_EXECUTION_FAILED,
        error: streamChunk.error,
      })
      return `提取失败: ${streamChunk.error}`
    }
  }

  logger.info(`Summary extracted for chunk ${chunkIndex}`, {
    route: '/chat',
    requestType: 'file_analysis',
    taskId: context.taskId,
    skill: 'file-chat',
    model: textExecutor.model,
    summaryLength: summary.length,
  })
  return summary
}
