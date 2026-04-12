/**
 * RAG（检索增强生成）工具
 *
 * 根据用户问题智能检索代码文件中的相关部分
 * 只发送匹配的代码片段 + 上下文，节省 90%+ 的 tokens
 */
import { formatRetrievedCode } from './ragFormatter';
import { extractKeywords } from './ragKeywords';
import { addContext, createFallbackSnippet, deduplicateSnippets, scoreSnippets } from './ragSelection';
import { detectLanguage, parseCodeToSnippets } from './ragSnippets';
import type { RetrievalOptions, RetrievalResult } from './ragTypes';

export type { CodeSnippet, RetrievalOptions, RetrievalResult } from './ragTypes';
export { detectLanguage, formatRetrievedCode };

/**
 * 根据用户问题检索代码片段
 *
 * @param code - 完整代码
 * @param query - 用户问题
 * @param language - 语言类型
 * @param options - 检索选项
 * @returns 检索结果
 */
export function retrieveRelevantCode(
  code: string,
  query: string,
  language: string,
  options: RetrievalOptions = {},
): RetrievalResult {
  const {
    maxSnippets = 10,
    contextLines = 10,
    minRelevance = 0.1,
  } = options;

  const keywords = extractKeywords(query);
  const allSnippets = parseCodeToSnippets(code, language);
  const scoredSnippets = scoreSnippets(allSnippets, keywords, query);

  let filteredSnippets = scoredSnippets
    .filter((snippet) => snippet.relevanceScore >= minRelevance)
    .sort((a, b) => b.relevanceScore - a.relevanceScore);

  if (keywords.length > 0 && filteredSnippets.length === 0) {
    filteredSnippets = scoredSnippets
      .filter((snippet) => snippet.relevanceScore >= 0.05)
      .sort((a, b) => b.relevanceScore - a.relevanceScore);
  }

  const selectedSnippets = filteredSnippets.slice(0, maxSnippets);
  const snippetsWithContext = selectedSnippets.map((snippet) =>
    addContext(snippet, code, contextLines),
  );

  if (snippetsWithContext.length === 0) {
    snippetsWithContext.push(createFallbackSnippet(code));
  }

  const uniqueContent = deduplicateSnippets(snippetsWithContext);
  const totalLines = code.split('\n').length;
  const selectedLines = uniqueContent.reduce(
    (sum, snippet) => sum + (snippet.lineRange[1] - snippet.lineRange[0] + 1),
    0,
  );

  return {
    query,
    extractedKeywords: keywords,
    matchedSnippets: snippetsWithContext,
    totalLines,
    selectedLines,
    coverageRatio: selectedLines / totalLines,
  };
}
