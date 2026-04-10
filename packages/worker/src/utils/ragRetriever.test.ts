import { describe, expect, it } from 'vitest';
import { detectLanguage, formatRetrievedCode, retrieveRelevantCode } from './ragRetriever';

describe('ragRetriever', () => {
  it('应该优先命中查询里提到的函数片段', () => {
    const code = [
      'function buildPrompt() {',
      '  return "prompt";',
      '}',
      '',
      'function mergeChunks() {',
      '  return "merged";',
      '}',
    ].join('\n');

    const result = retrieveRelevantCode(code, 'mergeChunks 是做什么的', 'javascript');

    expect(result.extractedKeywords).toContain('mergeChunks');
    expect(result.matchedSnippets[0]?.name).toBe('mergeChunks');
  });

  it('应该在没有直接匹配时回退到文件概览', () => {
    const code = Array.from({ length: 80 }, (_, index) => `line ${index + 1}`).join('\n');
    const result = retrieveRelevantCode(code, '完全不相关的问题', 'plaintext', {
      minRelevance: 0.9,
    });

    expect(result.matchedSnippets).toHaveLength(1);
    expect(result.matchedSnippets[0]?.id).toBe('fallback');
    expect(formatRetrievedCode(result)).toContain('智能检索结果');
  });

  it('应该根据扩展名识别语言', () => {
    expect(detectLanguage('demo.ts')).toBe('typescript');
    expect(detectLanguage('demo.py')).toBe('python');
  });
});
