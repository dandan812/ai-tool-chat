import { estimateTokens } from './chunker';
import type { CompressResult } from './codeCompressionTypes';

function countLines(code: string): number {
  return code.split('\n').length;
}

/**
 * 统计单独拆出来，是为了让压缩主入口只剩“清理 -> 提取 -> 构建”三段。
 * 行数和 token 估算属于结果整理，不应该继续占据主流程阅读负担。
 */
export function createCompressStats(
  originalCode: string,
  compressedCode: string,
  functionsFound: number,
  classesFound: number,
): CompressResult['stats'] {
  const originalLines = countLines(originalCode);
  const compressedLines = countLines(compressedCode);
  const originalTokens = estimateTokens(originalCode);
  const compressedTokens = estimateTokens(compressedCode);

  return {
    originalLines,
    compressedLines,
    originalTokens,
    compressedTokens,
    reductionRatio: originalTokens > 0 ? 1 - (compressedTokens / originalTokens) : 0,
    functionsFound,
    classesFound,
  };
}
