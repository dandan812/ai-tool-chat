import type { CodeSnippet } from './ragTypes';

export function scoreSnippets(snippets: CodeSnippet[], keywords: string[], query: string): CodeSnippet[] {
  return snippets.map((snippet) => ({
    ...snippet,
    relevanceScore: calculateRelevance(snippet, keywords, query),
  }));
}

/**
 * 这层聚焦“从候选片段中挑出最值得给模型看的内容”，
 * 把评分、补上下文和去重放在一起，主入口就只需要表达选择流程。
 */
export function addContext(snippet: CodeSnippet, code: string, contextLines: number): CodeSnippet {
  const lines = code.split('\n');
  const [startLine, endLine] = snippet.lineRange;
  const contextStart = Math.max(1, startLine - contextLines);
  const contextEnd = Math.min(lines.length, endLine + contextLines);

  return {
    ...snippet,
    content: lines.slice(contextStart - 1, contextEnd).join('\n'),
    lineRange: [contextStart, contextEnd],
  };
}

export function deduplicateSnippets(snippets: CodeSnippet[]): CodeSnippet[] {
  if (snippets.length <= 1) {
    return snippets;
  }

  const result: CodeSnippet[] = [];
  for (const snippet of snippets) {
    const isDuplicate = result.some((existing) => isOverlapping(snippet, existing));
    if (!isDuplicate) {
      result.push(snippet);
    }
  }

  return result;
}

export function createFallbackSnippet(code: string): CodeSnippet {
  const lines = code.split('\n');
  return {
    id: 'fallback',
    type: 'other',
    content: [
      '// === 文件头部 ===',
      lines.slice(0, 30).join('\n'),
      '',
      '// === 文件尾部 ===',
      lines.slice(-30).join('\n'),
    ].join('\n'),
    lineRange: [1, lines.length],
    relevanceScore: 0,
    keywords: [],
  };
}

function calculateRelevance(snippet: CodeSnippet, keywords: string[], query: string): number {
  let score = 0;
  const content = snippet.content.toLowerCase();
  const queryLower = query.toLowerCase();

  if (snippet.name) {
    for (const keyword of keywords) {
      if (keyword.toLowerCase() === snippet.name.toLowerCase()) {
        score += 0.5;
      } else if (snippet.name.toLowerCase().includes(keyword.toLowerCase())) {
        score += 0.3;
      }
    }
  }

  for (const keyword of keywords) {
    const keywordLower = keyword.toLowerCase();
    if (content.includes(keywordLower)) {
      score += 0.2;
      const matches = (content.match(new RegExp(keywordLower, 'g')) || []).length;
      score += Math.min(matches * 0.05, 0.3);
    }
  }

  if (content.includes(queryLower)) {
    score += 0.3;
  }

  const length = snippet.lineRange[1] - snippet.lineRange[0];
  if (length < 5) score -= 0.1;
  if (length > 100) score -= 0.2;

  return Math.max(0, Math.min(1, score));
}

function isOverlapping(a: CodeSnippet, b: CodeSnippet): boolean {
  if (a.type === b.type && a.name === b.name && a.name) {
    return true;
  }

  const [aStart, aEnd] = a.lineRange;
  const [bStart, bEnd] = b.lineRange;
  return !(aEnd < bStart || bEnd < aStart);
}
