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

// ==================== 语言配置 ====================

interface LanguageConfig {
  name: string;
  singleLineComment: RegExp;
  multiLineComment: [RegExp, RegExp]; // [start, end]
  functionPattern: RegExp;
  classPattern: RegExp;
  variablePattern?: RegExp;
  keywords: string[];
}

/**
 * 各种语言的配置
 */
const LANGUAGE_CONFIGS: Record<string, LanguageConfig> = {
  javascript: {
    name: 'JavaScript',
    singleLineComment: /\/\/.*$/gm,
    multiLineComment: [/\/\*/, /\*\//],
    functionPattern: /(?:function\s+(\w+)|(\w+)\s*\([^)]*\)\s*(?:=>|\{))/g,
    classPattern: /class\s+(\w+)/g,
    variablePattern: /(?:const|let|var)\s+(\w+)\s*=\s*(?:function|\([^)]*\)\s*=>)/g,
    keywords: ['if', 'else', 'for', 'while', 'return', 'try', 'catch', 'async', 'await', 'import', 'export', 'default'],
  },
  typescript: {
    name: 'TypeScript',
    singleLineComment: /\/\/.*$/gm,
    multiLineComment: [/\/\*/, /\*\//],
    functionPattern: /(?:function\s+(\w+)|(\w+)\s*\([^)]*\)(?:\s*:\s*[\w<>\[\]]+)?\s*(?:=>|\{))/g,
    classPattern: /(?:class|interface|type)\s+(\w+)/g,
    variablePattern: /(?:const|let|var)\s+(\w+)\s*(?::\s*[\w<>\[\]]+)?\s*=\s*(?:function|\([^)]*\)(?:\s*:\s*[\w<>\[\]]+)?\s*=>)/g,
    keywords: ['if', 'else', 'for', 'while', 'return', 'try', 'catch', 'async', 'await', 'import', 'export', 'default', 'interface', 'type'],
  },
  python: {
    name: 'Python',
    singleLineComment: /#.*$/gm,
    multiLineComment: [/"""/g, /"""/g], // Python 的多行字符串作为注释
    functionPattern: /def\s+(\w+)\s*\(/g,
    classPattern: /class\s+(\w+)/g,
    variablePattern: /(\w+)\s*=\s*(?:lambda|def)/g,
    keywords: ['if', 'else', 'elif', 'for', 'while', 'return', 'try', 'except', 'async', 'await', 'import', 'from', 'as'],
  },
  java: {
    name: 'Java',
    singleLineComment: /\/\/.*$/gm,
    multiLineComment: [/\/\*/, /\*\//],
    functionPattern: /(?:public|private|protected|static)?\s*(?:\w+)\s+(\w+)\s*\([^)]*\)\s*(?:throws\s+\w+)?\s*\{/g,
    classPattern: /(?:public\s+)?class\s+(\w+)/g,
    variablePattern: /(?:public|private|protected|static)?\s*(?:\w+)\s+(\w+)\s*=/g,
    keywords: ['if', 'else', 'for', 'while', 'return', 'try', 'catch', 'finally', 'throws', 'import', 'package', 'class'],
  },
  go: {
    name: 'Go',
    singleLineComment: /\/\/.*$/gm,
    multiLineComment: [/\/\*/, /\*\//],
    functionPattern: /func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)\s*\(/g,
    classPattern: /type\s+(\w+)\s+struct/g,
    keywords: ['if', 'else', 'for', 'range', 'return', 'defer', 'go', 'select', 'switch', 'case', 'import', 'package'],
  },
  rust: {
    name: 'Rust',
    singleLineComment: /\/\/.*$/gm,
    multiLineComment: [/\/\*/, /\*\//],
    functionPattern: /(?:pub\s+)?fn\s+(\w+)\s*</g,
    classPattern: /(?:pub\s+)?(struct|enum|trait)\s+(\w+)/g,
    keywords: ['if', 'else', 'match', 'for', 'while', 'return', 'impl', 'let', 'mut', 'use', 'mod'],
  },
  c: {
    name: 'C',
    singleLineComment: /\/\/.*$/gm,
    multiLineComment: [/\/\*/, /\*\//],
    functionPattern: /\w+\s+(\w+)\s*\([^)]*\)\s*\{/g,
    classPattern: /(?:struct|enum)\s+(\w+)/g,
    keywords: ['if', 'else', 'for', 'while', 'return', 'include', 'define', 'typedef'],
  },
  cpp: {
    name: 'C++',
    singleLineComment: /\/\/.*$/gm,
    multiLineComment: [/\/\*/, /\*\//],
    functionPattern: /(?:\w+::)?(\w+)\s*\([^)]*\)(?:\s*(?:const)?)?\s*\{/g,
    classPattern: /class\s+(\w+)/g,
    keywords: ['if', 'else', 'for', 'while', 'return', 'class', 'public', 'private', 'protected', 'template', 'include'],
  },
};

// ==================== 主要导出函数 ====================

/**
 * 代码压缩接口
 */
export interface CompressResult {
  compressedCode: string;
  stats: {
    originalLines: number;
    compressedLines: number;
    originalTokens: number;
    compressedTokens: number;
    reductionRatio: number; // 压缩比例 0-1
    functionsFound: number;
    classesFound: number;
  };
}

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
    // 不支持的格式，直接返回原始代码
    return {
      compressedCode: code,
      stats: {
        originalLines: countLines(code),
        compressedLines: countLines(code),
        originalTokens: estimateTokens(code),
        compressedTokens: estimateTokens(code),
        reductionRatio: 0,
        functionsFound: 0,
        classesFound: 0,
      },
    };
  }

  // 移除注释
  let compressed = removeComments(code, config);

  // 移除空行（连续空行合并为一行）
  compressed = removeExtraLines(compressed);

  // 提取关键结构
  const structures = extractCodeStructures(compressed, config);

  // 构建压缩后的代码
  compressed = buildCompressedCode(compressed, structures, config);

  const originalLines = countLines(code);
  const compressedLines = countLines(compressed);
  const originalTokens = estimateTokens(code);
  const compressedTokens = estimateTokens(compressed);

  return {
    compressedCode: compressed,
    stats: {
      originalLines,
      compressedLines,
      originalTokens,
      compressedTokens,
      reductionRatio: 1 - (compressedTokens / originalTokens),
      functionsFound: structures.functions.length,
      classesFound: structures.classes.length,
    },
  };
}

// ==================== 注释移除 ====================

/**
 * 移除注释
 */
function removeComments(code: string, config: LanguageConfig): string {
  let result = code;

  // 先移除多行注释
  result = removeMultiLineComments(result, config.multiLineComment[0], config.multiLineComment[1]);

  // 再移除单行注释
  result = result.replace(config.singleLineComment, '');

  return result;
}

/**
 * 移除多行注释
 */
function removeMultiLineComments(code: string, startPattern: RegExp, endPattern: RegExp): string {
  let result = '';
  let i = 0;

  while (i < code.length) {
    // 检查是否匹配开始模式
    const startMatch = code.substring(i).match(startPattern);
    if (startMatch && startMatch.index !== undefined) {
      // 找到开始，跳到开始位置
      i += startMatch.index + startMatch[0].length;

      // 查找结束位置
      const endMatch = code.substring(i).match(endPattern);
      if (endMatch && endMatch.index !== undefined) {
        // 找到结束，跳过整个注释块
        i += endMatch.index + endMatch[0].length;
      } else {
        // 没有找到结束，跳到文件末尾
        break;
      }
    } else {
      result += code[i];
      i++;
    }
  }

  return result;
}

/**
 * 移除多余空行
 */
function removeExtraLines(code: string): string {
  // 将连续 3 个或更多换行替换为 2 个换行
  return code.replace(/\n{3,}/g, '\n\n').trim();
}

// ==================== 结构提取 ====================

interface CodeStructure {
  functions: FunctionInfo[];
  classes: ClassInfo[];
  variables: VariableInfo[];
}

interface FunctionInfo {
  name: string;
  signature: string;
  lineRange: [number, number];
  bodyLines: number;
  hasReturn: boolean;
  hasAsync: boolean;
}

interface ClassInfo {
  name: string;
  declaration: string;
  lineRange: [number, number];
  methods: string[];
}

interface VariableInfo {
  name: string;
  declaration: string;
  line: number;
}

/**
 * 提取代码结构
 */
function extractCodeStructures(code: string, config: LanguageConfig): CodeStructure {
  const lines = code.split('\n');
  const structures: CodeStructure = {
    functions: [],
    classes: [],
    variables: [],
  };

  // 提取函数
  structures.functions = extractFunctions(code, lines, config);

  // 提取类
  structures.classes = extractClasses(code, lines, config);

  // 提取变量（如果是全局变量）
  if (config.variablePattern) {
    structures.variables = extractVariables(code, lines, config);
  }

  return structures;
}

/**
 * 提取函数
 */
function extractFunctions(code: string, lines: string[], config: LanguageConfig): FunctionInfo[] {
  const functions: FunctionInfo[] = [];
  let match;

  // 重置正则
  const regex = new RegExp(config.functionPattern.source, 'g');

  while ((match = regex.exec(code)) !== null) {
    const name = match[1] || match[2];
    if (!name) continue;

    // 获取函数签名
    const startPos = match.index;
    let endPos = code.indexOf('{', startPos);
    if (endPos === -1) {
      // Python 风格，查找冒号
      endPos = code.indexOf(':', startPos);
      if (endPos === -1) continue;
    }

    const signature = code.substring(startPos, endPos + 1).trim();
    const signatureLines = code.substring(0, startPos + 1).split('\n');
    const startLine = signatureLines.length;

    // 计算函数体行数
    const bodyEnd = findMatchingBrace(code, endPos);
    const bodyCode = code.substring(endPos + 1, bodyEnd !== -1 ? bodyEnd : code.length);
    const bodyLines = bodyCode.split('\n').length;

    // 检查是否有 return
    const hasReturn = /return\s+[^\n;]+/.test(bodyCode);
    // 检查是否异步
    const hasAsync = /async/.test(signature);

    functions.push({
      name,
      signature,
      lineRange: [startLine, startLine + bodyLines],
      bodyLines,
      hasReturn,
      hasAsync,
    });
  }

  return functions;
}

/**
 * 提取类
 */
function extractClasses(code: string, lines: string[], config: LanguageConfig): ClassInfo[] {
  const classes: ClassInfo[] = [];
  let match;

  const regex = new RegExp(config.classPattern.source, 'g');

  while ((match = regex.exec(code)) !== null) {
    const name = match[1] || match[2];
    if (!name) continue;

    const startPos = match.index;
    const line = code.substring(0, startPos + 1).split('\n');
    const startLine = line.length;

    // 查找类结束位置
    const bodyStart = code.indexOf('{', startPos);
    if (bodyStart === -1) continue;

    const bodyEnd = findMatchingBrace(code, bodyStart);
    const bodyCode = code.substring(bodyStart + 1, bodyEnd !== -1 ? bodyEnd : code.length);

    // 提取方法名
    const methods: string[] = [];
    const methodRegex = new RegExp(config.functionPattern.source, 'g');
    let methodMatch;

    while ((methodMatch = methodRegex.exec(bodyCode)) !== null) {
      const methodName = methodMatch[1] || methodMatch[2];
      if (methodName && !config.keywords.includes(methodName)) {
        methods.push(methodName);
      }
    }

    classes.push({
      name,
      declaration: code.substring(startPos, bodyStart + 1).trim(),
      lineRange: [startLine, startLine + bodyCode.split('\n').length],
      methods,
    });
  }

  return classes;
}

/**
 * 提取变量
 */
function extractVariables(code: string, lines: string[], config: LanguageConfig): VariableInfo[] {
  const variables: VariableInfo[] = [];
  let match;

  if (!config.variablePattern) return variables;

  const regex = new RegExp(config.variablePattern.source, 'g');

  while ((match = regex.exec(code)) !== null) {
    const name = match[1];
    if (!name || config.keywords.includes(name)) continue;

    const startPos = match.index;
    const lineNum = code.substring(0, startPos + 1).split('\n').length;

    variables.push({
      name,
      declaration: match[0],
      line: lineNum,
    });
  }

  return variables;
}

// ==================== 代码构建 ====================

/**
 * 构建压缩后的代码
 */
function buildCompressedCode(
  code: string,
  structures: CodeStructure,
  config: LanguageConfig
): string {
  const parts: string[] = [];

  // 添加文件头
  const languageName = config.name;
  parts.push(`// ${languageName} 代码压缩预览`);
  parts.push(`// 原始代码已压缩，只保留关键结构\n`);

  // 添加类定义
  if (structures.classes.length > 0) {
    parts.push('// ===== 类定义 =====');
    for (const cls of structures.classes) {
      parts.push(`${cls.declaration}`);
      if (cls.methods.length > 0) {
        parts.push(`  // 方法: ${cls.methods.join(', ')}`);
      }
      parts.push('');
    }
  }

  // 添加函数定义
  if (structures.functions.length > 0) {
    parts.push('// ===== 函数定义 =====');
    for (const fn of structures.functions) {
      parts.push(`${fn.signature}`);
      // 添加函数体摘要
      const features = [];
      if (fn.bodyLines > 0) features.push(`${fn.bodyLines} 行`);
      if (fn.hasReturn) features.push('返回值');
      if (fn.hasAsync) features.push('异步');

      parts.push(`  // ${features.length > 0 ? features.join(', ') : '空函数'}`);
      parts.push('');
    }
  }

  // 添加重要变量
  if (structures.variables.length > 0) {
    parts.push('// ===== 全局变量 =====');
    for (const v of structures.variables) {
      parts.push(`${v.declaration}`);
    }
  }

  return parts.join('\n');
}

// ==================== 工具函数 ====================

/**
 * 查找匹配的括号
 */
function findMatchingBrace(code: string, startPos: number): number {
  let depth = 1;
  let pos = startPos + 1;

  while (pos < code.length && depth > 0) {
    const char = code[pos];
    if (char === '{') depth++;
    else if (char === '}') depth--;
    pos++;
  }

  return depth === 0 ? pos - 1 : -1;
}

/**
 * 获取语言配置
 */
function getLanguageConfig(language: string): LanguageConfig | null {
  const langMap: Record<string, string> = {
    'js': 'javascript',
    'jsx': 'javascript',
    'ts': 'typescript',
    'tsx': 'typescript',
    'py': 'python',
    'java': 'java',
    'go': 'go',
    'rs': 'rust',
    'c': 'c',
    'cpp': 'cpp',
    'cc': 'cpp',
    'h': 'c',
    'hpp': 'cpp',
  };

  const key = langMap[language.toLowerCase()] || language.toLowerCase();
  return LANGUAGE_CONFIGS[key] || null;
}

/**
 * 计算行数
 */
function countLines(code: string): number {
  return code.split('\n').length;
}

/**
 * 估算 token 数量
 */
function estimateTokens(text: string): number {
  if (!text) return 0;

  // 统计中文字符和 ASCII 字符
  let chineseChars = 0;
  let asciiChars = 0;

  for (let i = 0; i < text.length; i++) {
    const charCode = text.charCodeAt(i);
    if (charCode > 0x7F) {
      chineseChars++;
    } else {
      asciiChars++;
    }
  }

  // 中文约 1.5 字符/token，英文约 4 字符/token
  const chineseTokens = Math.ceil(chineseChars / 1.5);
  const asciiTokens = Math.ceil(asciiChars / 4);

  return chineseTokens + asciiTokens;
}
