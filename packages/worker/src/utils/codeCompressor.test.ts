import { describe, expect, it } from 'vitest';
import { compressCode } from './codeCompressor';

describe('codeCompressor', () => {
  it('应该提取函数和类的关键结构', () => {
    const code = [
      'class UserService {',
      '  getUser() {',
      '    return "demo";',
      '  }',
      '}',
      '',
      'async function loadUser() {',
      '  return await fetch("/api/user");',
      '}',
    ].join('\n');

    const result = compressCode(code, 'ts');

    expect(result.compressedCode).toContain('类定义');
    expect(result.compressedCode).toContain('函数定义');
    expect(result.stats.functionsFound).toBeGreaterThan(0);
    expect(result.stats.classesFound).toBeGreaterThan(0);
  });

  it('应该在未知语言时回退为原始代码', () => {
    const code = 'plain text';
    const result = compressCode(code, 'unknown-lang');

    expect(result.compressedCode).toBe(code);
    expect(result.stats.functionsFound).toBe(0);
    expect(result.stats.classesFound).toBe(0);
  });
});
