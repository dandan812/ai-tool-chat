import type { Env, ResolvedFileContent, EvidenceSource } from "../../types";
import {
  createEvidenceSource,
  formatEvidenceSources,
  MAX_EVIDENCE_EXCERPT_CHARS,
} from "../evidence";
import { splitTextRanges } from "../../utils/chunker";
import { rankTextContents, type TextMatchExplanation } from "./lexicalRanking";
import { logger } from "../../infrastructure/logger";
import { getUploadedFileTextIndexObjectKey } from "../../upload/uploadedFileStorage";

const TEXT_INDEX_VERSION = 3;

export interface TextChunk {
  id: string;
  fileId: string;
  fileName: string;
  chunkIndex: number;
  tokenCount: number;
  content: string;
  evidence: EvidenceSource;
}

export interface TextRetrievalIndex {
  version: number;
  fileId: string;
  fileName: string;
  fileHash: string;
  totalTokens: number;
  chunkSizeTokens: number;
  createdAt: number;
  chunks: TextChunk[];
}

export interface RetrievedTextChunk extends TextChunk {
  relevanceScore: number;
  explanation?: TextMatchExplanation;
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
      if (
        parsed.version === TEXT_INDEX_VERSION &&
        parsed.chunkSizeTokens === chunkSizeTokens &&
        parsed.fileId === file.fileId &&
        parsed.fileHash === file.fileHash &&
        parsed.fileName === file.fileName
      ) {
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
  const allChunks = indices.flatMap((index) => index.chunks);
  const { keywords: extractedKeywords, scores } = rankTextContents(
    allChunks.map((chunk) => chunk.content),
    query,
  );
  const scoredChunks = allChunks
    .map((chunk, index) => ({ ...chunk, ...scores[index] }))
    .sort((a, b) => b.relevanceScore - a.relevanceScore);

  const initialSelection = scoredChunks.filter(
    (chunk) =>
      chunk.relevanceScore > 0 && chunk.relevanceScore >= options.minRelevance,
  );
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
        continue;
      }

      selectedChunks.push(chunk);
      selectedTokens += chunk.tokenCount;
    }
  }

  const totalTokens = indices.reduce(
    (sum, index) => sum + index.totalTokens,
    0,
  );
  const hasDirectMatch = selectedChunks.some(
    (chunk) => chunk.relevanceScore >= 0.35,
  );
  const insufficient =
    selectedChunks.length === 0 ||
    (!hasDirectMatch && extractedKeywords.length > 0);

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

  const totalTokens = indices.reduce(
    (sum, index) => sum + index.totalTokens,
    0,
  );

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
  parts.push(
    `- 关键词: ${result.extractedKeywords.join("、") || "无显式关键词"}`,
  );
  parts.push(
    `- 选中片段: ${result.selectedChunks.length}/${result.totalChunks}`,
  );
  parts.push(`- 估算覆盖率: ${(result.coverageRatio * 100).toFixed(2)}%`);
  if (result.budgetExceeded) {
    parts.push(`- 说明: 已按预算截断片段，请优先回答当前范围内的问题`);
  }
  parts.push("");

  for (const chunk of result.selectedChunks) {
    parts.push(`#### 文件 ${chunk.fileName} / 片段 ${chunk.chunkIndex + 1}`);
    parts.push(
      `- 词法匹配得分: ${chunk.relevanceScore.toFixed(3)}（不是事实支持概率）`,
    );
    if (chunk.explanation) {
      parts.push(
        `- 命中词: ${chunk.explanation.matchedTerms.map((match) => match.term).join("、")}`,
      );
    }
    parts.push(`- 大小: ${chunk.tokenCount} tokens`);
    parts.push(formatEvidenceSources([chunk.evidence]));
    parts.push("");
  }

  return parts.join("\n");
}

export function buildTextRetrievalIndex(
  file: ResolvedFileContent,
  chunkSizeTokens: number,
): TextRetrievalIndex {
  const chunks = splitTextIntoRetrievalChunks(file, chunkSizeTokens);
  const totalTokens = chunks.reduce((sum, chunk) => sum + chunk.tokenCount, 0);

  return {
    version: TEXT_INDEX_VERSION,
    fileId: file.fileId,
    fileName: file.fileName,
    fileHash: file.fileHash,
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
  return splitTextRanges(
    file.content,
    chunkSizeTokens,
    MAX_EVIDENCE_EXCERPT_CHARS,
  ).map((range, chunkIndex) => ({
    id: `${file.fileId}-chunk-${chunkIndex}`,
    fileId: file.fileId,
    fileName: file.fileName,
    chunkIndex,
    tokenCount: range.tokenCount,
    content: file.content.slice(range.startOffset, range.endOffset),
    evidence: createEvidenceSource(file, range.startOffset, range.endOffset),
  }));
}
