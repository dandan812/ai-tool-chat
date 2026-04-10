/**
 * 代码压缩工具
 *
 * 针对代码文件进行智能压缩，只保留关键结构：
 * 1. 移除注释
 * 2. 移除空行
 * 3. 只保留函数签名、类定义、重要变量声明
 * 4. 对于函数体，只返回摘要（行数 + 关键逻辑）
 *
 * 目标：节省 60-80% 的 tokens
 */
import { buildCompressedCode } from './codeCompressionBuilder';
import { removeComments, removeExtraLines } from './codeCompressionCleanup';
import { getLanguageConfig } from './codeCompressionLanguages';
import { createCompressStats } from './codeCompressionStats';
import type { CompressResult } from './codeCompressionTypes';
import { extractCodeStructures } from './codeStructureExtractor';

export type { CompressResult } from './codeCompressionTypes';

/**
 * 压缩代码
 *
 * @param code - 原始代码
 * @param language - 语言类型（js, ts, py, java 等）
 * @returns 压缩结果
 */
export function compressCode(code: string, language: string): CompressResult {
  const config = getLanguageConfig(language);
  if (!config) {
    return {
      compressedCode: code,
      stats: createCompressStats(code, code, 0, 0),
    };
  }

  let compressed = removeComments(code, config);
  compressed = removeExtraLines(compressed);
  const structures = extractCodeStructures(compressed, config);
  compressed = buildCompressedCode(structures, config);

  return {
    compressedCode: compressed,
    stats: createCompressStats(
      code,
      compressed,
      structures.functions.length,
      structures.classes.length,
    ),
  };
}
