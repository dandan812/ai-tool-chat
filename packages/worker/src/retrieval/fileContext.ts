import type { Env, EvidenceSource, Message, ResolvedFileContent } from '../types';
import { estimateTokens } from '../utils/chunker';
import {
  createEvidenceSource, formatEvidenceSources, getOriginalLineStarts, limitEvidenceSources,
  MAX_EVIDENCE_EXCERPT_CHARS, MAX_EVIDENCE_TOTAL_CHARS,
} from './evidence';
import {
  buildTextRetrievalIndex, formatRetrievedText, getOrCreateTextRetrievalIndex,
  retrieveOverviewText, retrieveRelevantText,
} from './text/textRetriever';
import { detectLanguage, retrieveRelevantCode } from './rag/ragRetriever';
import {
  createRagMessages, createSmallFileMessages, createTextOverviewMessages,
  createTextRetrievalMessages, createTextRetrievalNarrowScopeMessage,
} from '../utils/filePromptBuilders';

export type FileAnswerMode = 'direct' | 'retrieval' | 'overview' | 'code';
export interface FileAnswerContext {
  mode: FileAnswerMode;
  sources: EvidenceSource[];
  messages: Message[];
  emptyAnswer?: string;
}

const RETRIEVAL_OPTIONS = { chunkSizeTokens: 3000, topK: 8, maxPromptTokens: 32000, minRelevance: 0.12 };

/** 只选择原文和构造模型输入，不调用模型。 */
export async function buildFileAnswerContext(
  files: ResolvedFileContent[], question: string, env: Env, mode: FileAnswerMode,
): Promise<FileAnswerContext> {
  files = files.filter(file => /\S/u.test(file.content));
  if (mode === 'code') return buildCodeContext(files, question);
  if (mode === 'direct') {
    if (files.reduce((sum, file) => sum + file.content.length, 0) <= MAX_EVIDENCE_TOTAL_CHARS) {
      const sources = limitEvidenceSources(files.flatMap(file =>
        buildTextRetrievalIndex(file, 2400).chunks.map(chunk => chunk.evidence)));
      return {
        mode, sources, messages: sources.length ? createSmallFileMessages(formatEvidenceSources(sources), question) : [],
        ...(!sources.length ? { emptyAnswer: '提供的资料中没有找到足够依据：文件中没有可分析的文本。' } : {}),
      };
    }
    mode = 'retrieval';
  }
  const indices = await Promise.all(files.map(file =>
    getOrCreateTextRetrievalIndex(env, file, RETRIEVAL_OPTIONS.chunkSizeTokens)));
  const retrieval = mode === 'overview'
    ? retrieveOverviewText(indices, question, RETRIEVAL_OPTIONS)
    : retrieveRelevantText(indices, question, RETRIEVAL_OPTIONS);
  if (!retrieval.selectedChunks.length || (mode !== 'overview' && retrieval.insufficient)) {
    return {
      mode, sources: [], messages: [],
      emptyAnswer: createTextRetrievalNarrowScopeMessage(files.length, retrieval.totalTokens),
    };
  }
  const sources = limitEvidenceSources(retrieval.selectedChunks.map(chunk => chunk.evidence));
  const allowed = new Set(sources.map(source => source.sourceId));
  if (sources.length < retrieval.selectedChunks.length) retrieval.budgetExceeded = true;
  retrieval.selectedChunks = retrieval.selectedChunks.filter(chunk => allowed.has(chunk.evidence.sourceId));
  retrieval.selectedTokens = retrieval.selectedChunks.reduce((sum, chunk) => sum + chunk.tokenCount, 0);
  retrieval.coverageRatio = retrieval.selectedTokens / Math.max(retrieval.totalTokens, 1);
  const summary = {
    totalOriginalTokens: retrieval.totalTokens, totalProcessedTokens: retrieval.selectedTokens,
    reductionRatio: 1 - retrieval.coverageRatio, selectedChunkCount: sources.length,
    budgetExceeded: retrieval.budgetExceeded,
  };
  const messages = mode === 'overview'
    ? createTextOverviewMessages(formatRetrievedText(retrieval), question, summary)
    : createTextRetrievalMessages(formatRetrievedText(retrieval), question, summary);
  return { mode, sources, messages };
}

function buildCodeContext(files: ResolvedFileContent[], question: string): FileAnswerContext {
  const candidates: EvidenceSource[] = [];
  for (const file of files) {
    if (!file.content) continue;
    // The code parser counts LF lines; map standalone CR to LF for parsing only.
    // Evidence still slices the untouched original through its own line starts.
    const code = file.content.replace(/\r(?!\n)/g, '\n');
    const result = retrieveRelevantCode(code, question, detectLanguage(file.fileName), {
      maxSnippets: 8, contextLines: 15, minRelevance: 0.1, includeImports: true, includeComments: false,
    });
    const starts = getOriginalLineStarts(file);
    for (const snippet of result.matchedSnippets) {
      // 兜底片段的首尾不连续，必须分别引用，不能声称覆盖中间原文。
      const ranges: [number, number][] = snippet.id === 'fallback'
        ? [[1, Math.min(30, starts.length)], [Math.max(1, starts.length - 29), starts.length]]
        : [snippet.lineRange];
      for (const [first, last] of ranges) {
        const start = starts[Math.max(0, first - 1)];
        if (start === undefined) continue;
        const rangeEnd = starts[Math.min(last, starts.length)] ?? file.content.length;
        let end = Math.min(rangeEnd, start + MAX_EVIDENCE_EXCERPT_CHARS);
        if ((/[\uD800-\uDBFF]/.test(file.content[end - 1]) && /[\uDC00-\uDFFF]/.test(file.content[end]))
          || (file.content[end - 1] === '\r' && file.content[end] === '\n')) end--;
        if (end > start) candidates.push(createEvidenceSource(file, start, end));
      }
    }
  }
  const sources = limitEvidenceSources(candidates);
  const content = formatEvidenceSources(sources);
  const originalTokens = files.reduce((sum, file) => sum + estimateTokens(file.content), 0);
  const processedTokens = estimateTokens(content);
  return {
    mode: 'code', sources,
    messages: sources.length ? createRagMessages(content, question, {
      totalOriginalTokens: originalTokens, totalProcessedTokens: processedTokens,
      reductionRatio: 1 - processedTokens / Math.max(originalTokens, 1),
    }) : [],
    ...(!sources.length ? { emptyAnswer: '提供的资料中没有找到足够依据：没有可分析的代码原文。' } : {}),
  };
}
