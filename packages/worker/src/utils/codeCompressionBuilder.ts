import type { CodeStructure, LanguageConfig } from './codeCompressionTypes';

export function buildCompressedCode(
  structures: CodeStructure,
  config: LanguageConfig,
): string {
  const parts: string[] = [];

  parts.push(`// ${config.name} 代码压缩预览`);
  parts.push('// 原始代码已压缩，只保留关键结构\n');

  if (structures.classes.length > 0) {
    parts.push('// ===== 类定义 =====');
    for (const cls of structures.classes) {
      parts.push(cls.declaration);
      if (cls.methods.length > 0) {
        parts.push(`  // 方法: ${cls.methods.join(', ')}`);
      }
      parts.push('');
    }
  }

  if (structures.functions.length > 0) {
    parts.push('// ===== 函数定义 =====');
    for (const fn of structures.functions) {
      parts.push(fn.signature);
      const features: string[] = [];
      if (fn.bodyLines > 0) features.push(`${fn.bodyLines} 行`);
      if (fn.hasReturn) features.push('返回值');
      if (fn.hasAsync) features.push('异步');
      parts.push(`  // ${features.length > 0 ? features.join(', ') : '空函数'}`);
      parts.push('');
    }
  }

  if (structures.variables.length > 0) {
    parts.push('// ===== 全局变量 =====');
    for (const variable of structures.variables) {
      parts.push(variable.declaration);
    }
  }

  return parts.join('\n');
}
