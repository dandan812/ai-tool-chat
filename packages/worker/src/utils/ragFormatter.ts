import type { RetrievalResult } from './ragTypes';

export function formatRetrievedCode(result: RetrievalResult): string {
  const parts: string[] = [];

  parts.push('// =========== 智能检索结果 ===========');
  parts.push(`// 查询: ${result.query}`);
  parts.push(`// 提取关键词: ${result.extractedKeywords.join(', ')}`);
  parts.push(`// 找到 ${result.matchedSnippets.length} 个相关片段`);
  parts.push(`// 覆盖率: ${(result.coverageRatio * 100).toFixed(1)}%\n`);

  if (result.matchedSnippets.length === 0) {
    parts.push('// 未找到直接匹配的代码，返回文件概览：');
    parts.push(result.matchedSnippets[0]?.content || '// 无内容');
    return parts.join('\n');
  }

  for (const snippet of result.matchedSnippets) {
    parts.push(`// --- ${snippet.type.toUpperCase()}${snippet.name ? `: ${snippet.name}` : ''} ---`);
    parts.push(`// 相关性: ${(snippet.relevanceScore * 100).toFixed(0)}%`);
    parts.push(`// 行数: ${snippet.lineRange[0]}-${snippet.lineRange[1]}`);
    parts.push(snippet.content);
    parts.push('');
  }

  return parts.join('\n');
}
