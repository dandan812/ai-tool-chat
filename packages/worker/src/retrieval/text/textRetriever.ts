import type { Env, ResolvedFileContent } from '../../types';
import { estimateTokens, findSafeSplitPoint } from '../../utils/chunker';
import { logger } from "../../infrastructure/logger";
import { getUploadedFileTextIndexObjectKey } from "../../upload/uploadedFileStorage";

const TEXT_INDEX_VERSION = 1;
const ENGLISH_STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "about",
  "please", "what", "when", "where", "which", "who", "whom", "whose",
  "there", "their", "have", "has", "had", "been", "will", "would",
  "could", "should", "into", "after", "before", "does", "did", "are",
  "was", "were", "your", "my", "our", "can", "how", "why",
]);
const CHINESE_STOPWORDS = new Set([
  "这个", "那个", "这些", "那些", "文件", "内容", "里面", "其中", "一下", "一下子",
  "请问", "帮我", "告诉", "说明", "分析", "总结", "概括", "概述", "整体", "全文",
  "主要", "哪些", "什么", "怎么", "有没有", "是否", "以及", "还有", "一下", "一下吧",
  "一下吗", "一下呢", "部分", "章节", "段落", "文章", "文本", "资料",
]);

export interface TextChunk {
  id: string;
  fileId: string;
  fileName: string;
  chunkIndex: number;
  tokenCount: number;
  content: string;
}

export interface TextRetrievalIndex {
  version: number;
  fileId: string;
  fileName: string;
  totalTokens: number;
  chunkSizeTokens: number;
  createdAt: number;
  chunks: TextChunk[];
}

export interface RetrievedTextChunk extends TextChunk {
  relevanceScore: number;
}

export interface TextRetrievalResult {
  query: string;
  extractedKeywords: string[];
  selectedChunks: RetrievedTextChunk[];
  totalChunks: number;
  totalTokens: number;
  selectedTokens: number;
  coverageRatio: number;
  budgetExceeded: boolean;
  hasDirectMatch: boolean;
  insufficient: boolean;
}

export interface TextRetrievalOptions {
  chunkSizeTokens: number;
  topK: number;
  maxPromptTokens: number;
  minRelevance: number;
}

export async function getOrCreateTextRetrievalIndex(
  env: Env,
  file: ResolvedFileContent,
  chunkSizeTokens: number,
): Promise<TextRetrievalIndex> {
  const objectKey = getUploadedFileTextIndexObjectKey(file.fileId);
  const existing = await env.UPLOADED_FILES.get(objectKey);

  if (existing) {
    try {
      const parsed = JSON.parse(await existing.text()) as TextRetrievalIndex;
      if (parsed.version === TEXT_INDEX_VERSION && parsed.chunkSizeTokens === chunkSizeTokens) {
        return parsed;
      }
    } catch (error) {
      logger.warn("Text retrieval index parse failed, rebuilding", {
        fileId: file.fileId,
        error: String(error),
      });
    }
  }

  const index = buildTextRetrievalIndex(file, chunkSizeTokens);
  await env.UPLOADED_FILES.put(objectKey, JSON.stringify(index), {
    httpMetadata: {
      contentType: "application/json",
    },
    customMetadata: {
      fileId: file.fileId,
      fileName: file.fileName,
      kind: "text-retrieval-index",
    },
  });

  logger.info("Text retrieval index created", {
    fileId: file.fileId,
    chunkCount: index.chunks.length,
    totalTokens: index.totalTokens,
    chunkSizeTokens,
  });

  return index;
}

export function retrieveRelevantText(
  indices: TextRetrievalIndex[],
  query: string,
  options: TextRetrievalOptions,
): TextRetrievalResult {
  const extractedKeywords = extractTextKeywords(query);
  const scoredChunks = indices
    .flatMap((index) =>
      index.chunks.map((chunk) => ({
        ...chunk,
        relevanceScore: calculateTextRelevance(chunk.content, extractedKeywords, query),
      })),
    )
    .sort((a, b) => b.relevanceScore - a.relevanceScore);

  const initialSelection = scoredChunks.filter((chunk) => chunk.relevanceScore >= options.minRelevance);
  const selectedChunks: RetrievedTextChunk[] = [];
  let selectedTokens = 0;
  let budgetExceeded = false;

  for (const chunk of initialSelection) {
    if (selectedChunks.length >= options.topK) {
      budgetExceeded = true;
      break;
    }

    if (selectedTokens + chunk.tokenCount > options.maxPromptTokens) {
      budgetExceeded = true;
      continue;
    }

    selectedChunks.push(chunk);
    selectedTokens += chunk.tokenCount;
  }

  if (selectedChunks.length === 0) {
    const fallbackCandidates = scoredChunks
      .filter((chunk) => chunk.relevanceScore > 0)
      .slice(0, Math.min(2, options.topK));

    for (const chunk of fallbackCandidates) {
      if (selectedTokens + chunk.tokenCount > options.maxPromptTokens) {
        budgetExceeded = true;
        break;
      }

      selectedChunks.push(chunk);
      selectedTokens += chunk.tokenCount;
    }
  }

  const totalTokens = indices.reduce((sum, index) => sum + index.totalTokens, 0);
  const hasDirectMatch = selectedChunks.some((chunk) => chunk.relevanceScore >= 0.35);
  const insufficient = selectedChunks.length === 0 || (!hasDirectMatch && extractedKeywords.length > 0);

  return {
    query,
    extractedKeywords,
    selectedChunks,
    totalChunks: indices.reduce((sum, index) => sum + index.chunks.length, 0),
    totalTokens,
    selectedTokens,
    coverageRatio: totalTokens > 0 ? selectedTokens / totalTokens : 0,
    budgetExceeded,
    hasDirectMatch,
    insufficient,
  };
}

export function retrieveOverviewText(
  indices: TextRetrievalIndex[],
  query: string,
  options: Pick<TextRetrievalOptions, "topK" | "maxPromptTokens">,
): TextRetrievalResult {
  const allChunks = indices.flatMap((index) => index.chunks);
  const selectedChunks: RetrievedTextChunk[] = [];
  let selectedTokens = 0;
  let budgetExceeded = false;

  if (allChunks.length === 0) {
    return {
      query,
      extractedKeywords: [],
      selectedChunks,
      totalChunks: 0,
      totalTokens: 0,
      selectedTokens: 0,
      coverageRatio: 0,
      budgetExceeded: false,
      hasDirectMatch: false,
      insufficient: true,
    };
  }

  const desiredCount = Math.min(options.topK, allChunks.length);
  const candidateIndexes = new Set<number>();

  if (desiredCount === 1) {
    candidateIndexes.add(0);
  } else {
    for (let i = 0; i < desiredCount; i++) {
      const ratio = i / (desiredCount - 1);
      candidateIndexes.add(Math.round((allChunks.length - 1) * ratio));
    }
  }

  for (const index of candidateIndexes) {
    const chunk = allChunks[index];
    if (!chunk) {
      continue;
    }

    if (selectedTokens + chunk.tokenCount > options.maxPromptTokens) {
      budgetExceeded = true;
      continue;
    }

    selectedChunks.push({
      ...chunk,
      relevanceScore: 0.16,
    });
    selectedTokens += chunk.tokenCount;
  }

  const totalTokens = indices.reduce((sum, index) => sum + index.totalTokens, 0);

  return {
    query,
    extractedKeywords: [],
    selectedChunks: selectedChunks.sort((a, b) => a.chunkIndex - b.chunkIndex),
    totalChunks: allChunks.length,
    totalTokens,
    selectedTokens,
    coverageRatio: totalTokens > 0 ? selectedTokens / totalTokens : 0,
    budgetExceeded,
    hasDirectMatch: false,
    insufficient: selectedChunks.length === 0,
  };
}

export function formatRetrievedText(result: TextRetrievalResult): string {
  const parts: string[] = [];

  parts.push(`### 文本检索结果`);
  parts.push(`- 查询: ${result.query}`);
  parts.push(`- 关键词: ${result.extractedKeywords.join("、") || "无显式关键词"}`);
  parts.push(`- 选中片段: ${result.selectedChunks.length}/${result.totalChunks}`);
  parts.push(`- 估算覆盖率: ${(result.coverageRatio * 100).toFixed(2)}%`);
  if (result.budgetExceeded) {
    parts.push(`- 说明: 已按预算截断片段，请优先回答当前范围内的问题`);
  }
  parts.push("");

  for (const chunk of result.selectedChunks) {
    parts.push(`#### 文件 ${chunk.fileName} / 片段 ${chunk.chunkIndex + 1}`);
    parts.push(`- 相关性: ${(chunk.relevanceScore * 100).toFixed(0)}%`);
    parts.push(`- 大小: ${chunk.tokenCount} tokens`);
    parts.push(chunk.content);
    parts.push("");
  }

  return parts.join("\n");
}

function buildTextRetrievalIndex(
  file: ResolvedFileContent,
  chunkSizeTokens: number,
): TextRetrievalIndex {
  const chunks = splitTextIntoRetrievalChunks(file, chunkSizeTokens);
  const totalTokens = chunks.reduce((sum, chunk) => sum + chunk.tokenCount, 0);

  return {
    version: TEXT_INDEX_VERSION,
    fileId: file.fileId,
    fileName: file.fileName,
    totalTokens,
    chunkSizeTokens,
    createdAt: Date.now(),
    chunks,
  };
}

function splitTextIntoRetrievalChunks(
  file: ResolvedFileContent,
  chunkSizeTokens: number,
): TextChunk[] {
  const targetChars = Math.max(chunkSizeTokens * 3, 1200);
  const chunks: TextChunk[] = [];
  let start = 0;
  let chunkIndex = 0;

  while (start < file.content.length) {
    const remainingChars = file.content.length - start;
    let end = file.content.length;

    if (remainingChars > targetChars) {
      end = findSafeSplitPoint(file.content, start + targetChars);
      if (end <= start) {
        end = Math.min(file.content.length, start + targetChars);
      }
    }

    const content = file.content.slice(start, end).trim();
    if (content) {
      chunks.push({
        id: `${file.fileId}-chunk-${chunkIndex}`,
        fileId: file.fileId,
        fileName: file.fileName,
        chunkIndex,
        tokenCount: estimateTokens(content),
        content,
      });
      chunkIndex++;
    }

    start = end;
  }

  return chunks;
}

function extractTextKeywords(query: string): string[] {
  const keywords = new Set<string>();
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return [];
  }

  const quotedMatches = [...trimmedQuery.matchAll(/["'“”‘’`]+([^"'“”‘’`]+)["'“”‘’`]+/g)];
  for (const match of quotedMatches) {
    const value = match[1]?.trim();
    if (value) {
      keywords.add(value);
    }
  }

  const englishWords = trimmedQuery.toLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g) || [];
  for (const word of englishWords) {
    if (!ENGLISH_STOPWORDS.has(word)) {
      keywords.add(word);
    }
  }

  const chineseParts = trimmedQuery
    .replace(/[^\u4e00-\u9fff0-9]+/g, " ")
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  for (const part of chineseParts) {
    if (part.length <= 4) {
      if (!CHINESE_STOPWORDS.has(part)) {
        keywords.add(part);
      }
      continue;
    }

    for (let size = Math.min(4, part.length); size >= 2; size--) {
      for (let index = 0; index <= part.length - size; index++) {
        const slice = part.slice(index, index + size);
        if (!CHINESE_STOPWORDS.has(slice)) {
          keywords.add(slice);
        }
      }
    }
  }

  return [...keywords].slice(0, 24);
}

function calculateTextRelevance(content: string, keywords: string[], query: string): number {
  const lowerContent = content.toLowerCase();
  const normalizedQuery = query.trim().toLowerCase();
  let score = 0;

  if (normalizedQuery && normalizedQuery.length >= 6 && lowerContent.includes(normalizedQuery)) {
    score += 0.55;
  }

  for (const keyword of keywords) {
    const normalizedKeyword = keyword.toLowerCase();
    if (!normalizedKeyword) {
      continue;
    }

    if (lowerContent.includes(normalizedKeyword)) {
      const lengthWeight = Math.min(normalizedKeyword.length / 6, 1);
      score += 0.12 + lengthWeight * 0.1;
      const matches = lowerContent.split(normalizedKeyword).length - 1;
      score += Math.min(matches * 0.03, 0.18);
    }
  }

  if (keywords.length === 0 && normalizedQuery) {
    const compactQuery = normalizedQuery.replace(/\s+/g, "");
    if (compactQuery && lowerContent.includes(compactQuery)) {
      score += 0.25;
    }
  }

  const tokenCount = estimateTokens(content);
  if (tokenCount < 300) {
    score -= 0.05;
  }
  if (tokenCount > 4500) {
    score -= 0.08;
  }

  return Math.max(0, Math.min(1, score));
}
