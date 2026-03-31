/**
 * RAG（检索增强生成）工具
 *
 * 根据用户问题智能检索代码文件中的相关部分
 * 只发送匹配的代码片段 + 上下文，节省 90%+ 的 tokens
 */

// ==================== 类型定义 ====================

export interface CodeSnippet {
  id: string;
  type: 'function' | 'class' | 'variable' | 'import' | 'comment' | 'other';
  name?: string;
  content: string;
  lineRange: [number, number];
  relevanceScore: number; // 相关性评分 0-1
  keywords: string[];
}

export interface RetrievalResult {
  query: string;
  extractedKeywords: string[];
  matchedSnippets: CodeSnippet[];
  totalLines: number;
  selectedLines: number;
  coverageRatio: number; // 覆盖率
}

export interface RetrievalOptions {
  maxSnippets?: number; // 最多返回的片段数
  contextLines?: number; // 每个片段前后的上下文行数
  minRelevance?: number; // 最低相关性分数
  includeImports?: boolean; // 是否包含 import 语句
  includeComments?: boolean; // 是否包含注释
}

// ==================== 语言配置 ====================

interface LanguagePattern {
  function: RegExp;
  class: RegExp;
  variable: RegExp;
  import: RegExp;
  export: RegExp;
  comment: RegExp;
}

const LANGUAGE_PATTERNS: Record<string, LanguagePattern> = {
  javascript: {
    function: /(?:function\s+(\w+)|(\w+)\s*\([^)]*\)\s*(?:=>|\{))/g,
    class: /class\s+(\w+)/g,
    variable: /(?:const|let|var)\s+(\w+)\s*=/g,
    import: /import\s+.*?from\s+['"](.*?)['"]/g,
    export: /export\s+(?:default\s+)?(?:const|let|var|function|class)\s+(\w+)/g,
    comment: /\/\/.*|\/\*[\s\S]*?\*\//g,
  },
  typescript: {
    function: /(?:function\s+(\w+)|(\w+)\s*\([^)]*\)(?:\s*:\s*[\w<>\[\]]+)?\s*(?:=>|\{))/g,
    class: /(?:class|interface|type)\s+(\w+)/g,
    variable: /(?:const|let|var)\s+(\w+)\s*(?::\s*[\w<>\[\]]+)?\s*=/g,
    import: /import\s+.*?from\s+['"](.*?)['"]/g,
    export: /export\s+(?:default\s+)?(?:const|let|var|function|class|interface|type)\s+(\w+)/g,
    comment: /\/\/.*|\/\*[\s\S]*?\*\//g,
  },
  python: {
    function: /def\s+(\w+)\s*\(/g,
    class: /class\s+(\w+)/g,
    variable: /(\w+)\s*=\s*[^=]/g,
    import: /(?:import|from)\s+[\w.]+/g,
    export: null as any,
    comment: /#.*|"""[\s\S]*?"""|'''[\s\S]*?'''/g,
  },
  java: {
    function: /(?:\w+)\s+(\w+)\s*\([^)]*\)\s*(?:throws\s+\w+)?\s*\{/g,
    class: /class\s+(\w+)/g,
    variable: /(?:\w+)\s+(\w+)\s*=/g,
    import: /import\s+[\w.]+;/g,
    export: null as any,
    comment: /\/\/.*|\/\*[\s\S]*?\*\//g,
  },
  go: {
    function: /func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)\s*\(/g,
    class: /type\s+(\w+)\s+struct/g,
    variable: /(\w+)\s*:=?/g,
    import: /import\s+['"](.*?)['"]/g,
    export: null as any,
    comment: /\/\/.*|\/\*[\s\S]*?\*\//g,
  },
  rust: {
    function: /(?:pub\s+)?fn\s+(\w+)\s*</g,
    class: /(?:pub\s+)?(struct|enum|trait)\s+(\w+)/g,
    variable: /(?:let\s+)?(\w+)\s*:/g,
    import: /use\s+[\w:]+;/g,
    export: /pub\s+fn\s+(\w+)/g,
    comment: /\/\/.*|\/\*[\s\S]*?\*\//g,
  },
  c: {
    function: /\w+\s+(\w+)\s*\([^)]*\)\s*\{/g,
    class: /(?:struct|enum)\s+(\w+)/g,
    variable: /\w+\s+(\w+)\s*=/g,
    import: /#include\s+<[\w.]+>|#include\s+"[\w.]+"/g,
    export: null as any,
    comment: /\/\/.*|\/\*[\s\S]*?\*\//g,
  },
  cpp: {
    function: /(?:\w+::)?(\w+)\s*\([^)]*\)(?:\s*(?:const)?)?\s*\{/g,
    class: /class\s+(\w+)/g,
    variable: /(?:\w+)\s+(\w+)\s*=/g,
    import: /#include\s+<[\w.]+>|#include\s+"[\w.]+"/g,
    export: null as any,
    comment: /\/\/.*|\/\*[\s\S]*?\*\//g,
  },
};

const CODE_QUERY_KEYWORDS = [
  'function', 'class', 'method', 'variable', 'import', 'export', 'api', 'endpoint',
  'error', 'exception', 'try', 'catch', 'async', 'await', 'promise',
  'array', 'object', 'string', 'number', 'boolean', 'null', 'undefined',
  'if', 'else', 'for', 'while', 'loop', 'switch', 'case',
  'call', 'invoke', 'execute', 'run', 'start', 'stop', 'init',
  'get', 'set', 'add', 'remove', 'delete', 'update', 'create',
  'list', 'find', 'search', 'filter', 'map', 'reduce',
  'config', 'setting', 'option', 'parameter', 'arg',
  'handler', 'callback', 'listener', 'event', 'trigger',
  'component', 'view', 'page', 'screen', 'route', 'path',
  'data', 'model', 'entity', 'record', 'item', 'element',
  'service', 'controller', 'repository', 'factory', 'builder',
  'helper', 'util', 'common', 'base', 'core', 'shared',
];

const CHINESE_QUERY_KEYWORDS = [
  '函数', '类', '方法', '变量', '参数', '返回', '接口',
  '错误', '异常', '异步', '等待', '数组', '对象',
  '配置', '设置', '选项', '处理器', '回调', '事件',
  '组件', '页面', '路由', '路径', '数据', '模型',
  '服务', '控制器', '仓库', '工厂', '工具', '核心',
];

const IDENTIFIER_PATTERN = /\b([a-z_][a-z0-9_]*|get[A-Z][a-z]*|set[A-Z][a-z]*|handle[A-Z][a-z]*|on[A-Z][a-z]*)\b/gi;
const QUOTED_PATTERN = /['"`]([^'"`]+)['"`]/g;

const LANGUAGE_EXTENSION_MAP: Record<string, string> = {
  'js': 'javascript',
  'jsx': 'javascript',
  'mjs': 'javascript',
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

// ==================== 主要导出函数 ====================

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
  options: RetrievalOptions = {}
): RetrievalResult {
  const {
    maxSnippets = 10,
    contextLines = 10,
    minRelevance = 0.1,
    includeImports = true,
    includeComments = false,
  } = options;

  // 提取关键词
  const keywords = extractKeywords(query);

  // 解析代码为片段
  const allSnippets = parseCodeToSnippets(code, language);

  // 计算每个片段的相关性
  const scoredSnippets = allSnippets.map(snippet => ({
    ...snippet,
    relevanceScore: calculateRelevance(snippet, keywords, query),
  }));

  // 过滤和排序
  let filteredSnippets = scoredSnippets
    .filter(s => s.relevanceScore >= minRelevance)
    .sort((a, b) => b.relevanceScore - a.relevanceScore);

  // 如果有明确关键词但没有匹配，降低阈值再试一次
  if (keywords.length > 0 && filteredSnippets.length === 0) {
    filteredSnippets = scoredSnippets
      .filter(s => s.relevanceScore >= 0.05)
      .sort((a, b) => b.relevanceScore - a.relevanceScore);
  }

  // 选择前 N 个片段
  const selectedSnippets = filteredSnippets.slice(0, maxSnippets);

  // 添加上下文
  const snippetsWithContext = selectedSnippets.map(snippet =>
    addContext(snippet, code, contextLines)
  );

  // 如果没有匹配到任何内容，返回代码头部和尾部
  if (snippetsWithContext.length === 0) {
    snippetsWithContext.push(createFallbackSnippet(code));
  }

  // 合并所有片段，去除重复内容
  const uniqueContent = deduplicateSnippets(snippetsWithContext);

  // 计算覆盖率
  const totalLines = code.split('\n').length;
  const selectedLines = uniqueContent.reduce((sum, s) => sum + (s.lineRange[1] - s.lineRange[0] + 1), 0);

  return {
    query,
    extractedKeywords: keywords,
    matchedSnippets: snippetsWithContext,
    totalLines,
    selectedLines,
    coverageRatio: selectedLines / totalLines,
  };
}

/**
 * 生成用于发送给 AI 的检索后代码
 *
 * @param result - 检索结果
 * @returns 格式化后的代码字符串
 */
export function formatRetrievedCode(result: RetrievalResult): string {
  const parts: string[] = [];

  parts.push(`// =========== 智能检索结果 ===========`);
  parts.push(`// 查询: ${result.query}`);
  parts.push(`// 提取关键词: ${result.extractedKeywords.join(', ')}`);
  parts.push(`// 找到 ${result.matchedSnippets.length} 个相关片段`);
  parts.push(`// 覆盖率: ${(result.coverageRatio * 100).toFixed(1)}%\n`);

  if (result.matchedSnippets.length === 0) {
    parts.push('// 未找到直接匹配的代码，返回文件概览：');
    parts.push(result.matchedSnippets[0]?.content || '// 无内容');
  } else {
    for (const snippet of result.matchedSnippets) {
      parts.push(`// --- ${snippet.type.toUpperCase()}${snippet.name ? ': ' + snippet.name : ''} ---`);
      parts.push(`// 相关性: ${(snippet.relevanceScore * 100).toFixed(0)}%`);
      parts.push(`// 行数: ${snippet.lineRange[0]}-${snippet.lineRange[1]}`);
      parts.push(snippet.content);
      parts.push('');
    }
  }

  return parts.join('\n');
}

// ==================== 关键词提取 ====================

/**
 * 从查询中提取关键词
 */
function extractKeywords(query: string): string[] {
  const keywords: string[] = [];

  // 转换为小写
  const lowerQuery = query.toLowerCase();

  // 查找代码关键词
  for (const keyword of CODE_QUERY_KEYWORDS) {
    if (lowerQuery.includes(keyword)) {
      keywords.push(keyword);
    }
  }

  // 查找中文关键词
  for (const keyword of CHINESE_QUERY_KEYWORDS) {
    if (query.includes(keyword)) {
      keywords.push(keyword);
    }
  }

  // 提取看起来像标识符的词（驼峰命名、下划线命名等）
  const identifiers = query.match(IDENTIFIER_PATTERN);
  if (identifiers) {
    keywords.push(...identifiers);
  }

  // 提取引号中的内容（可能是具体的函数名/类名）
  const quoted = query.match(QUOTED_PATTERN);
  if (quoted) {
    keywords.push(...quoted.map(q => q.replace(/['"`]/g, '')));
  }

  // 去重并返回
  return [...new Set(keywords)];
}

// ==================== 代码解析 ====================

/**
 * 将代码解析为片段
 */
function parseCodeToSnippets(code: string, language: string): CodeSnippet[] {
  const snippets: CodeSnippet[] = [];
  const pattern = LANGUAGE_PATTERNS[language.toLowerCase()];

  if (!pattern) {
    // 不支持的语言，按行创建片段
    return createLineBasedSnippets(code);
  }

  // 解析函数
  let match;
  const functionRegex = new RegExp(pattern.function.source, 'g');
  while ((match = functionRegex.exec(code)) !== null) {
    const name = match[1] || match[2];
    if (name) {
      const startPos = match.index;
      const lineNum = code.substring(0, startPos + 1).split('\n').length;
      const endPos = findMatchingBrace(code, code.indexOf('{', startPos));
      const endLine = endPos !== -1
        ? code.substring(0, endPos + 1).split('\n').length
        : lineNum + 1;

      snippets.push({
        id: `fn-${name}-${lineNum}`,
        type: 'function',
        name,
        content: extractCodeBlock(code, startPos, endPos !== -1 ? endPos + 1 : code.length),
        lineRange: [lineNum, endLine],
        relevanceScore: 0,
        keywords: [name],
      });
    }
  }

  // 解析类
  const classRegex = new RegExp(pattern.class.source, 'g');
  while ((match = classRegex.exec(code)) !== null) {
    const name = match[1] || match[2];
    if (name) {
      const startPos = match.index;
      const lineNum = code.substring(0, startPos + 1).split('\n').length;
      const endPos = findMatchingBrace(code, code.indexOf('{', startPos));
      const endLine = endPos !== -1
        ? code.substring(0, endPos + 1).split('\n').length
        : lineNum + 1;

      snippets.push({
        id: `class-${name}-${lineNum}`,
        type: 'class',
        name,
        content: extractCodeBlock(code, startPos, endPos !== -1 ? endPos + 1 : code.length),
        lineRange: [lineNum, endLine],
        relevanceScore: 0,
        keywords: [name],
      });
    }
  }

  // 解析 import
  const importRegex = new RegExp(pattern.import.source, 'g');
  while ((match = importRegex.exec(code)) !== null) {
    const lineNum = code.substring(0, match.index + 1).split('\n').length;
    snippets.push({
      id: `import-${lineNum}`,
      type: 'import',
      content: match[0].trim(),
      lineRange: [lineNum, lineNum],
      relevanceScore: 0,
      keywords: [],
    });
  }

  return snippets;
}

/**
 * 按行创建片段（用于不支持的语言）
 */
function createLineBasedSnippets(code: string): CodeSnippet[] {
  const snippets: CodeSnippet[] = [];
  const lines = code.split('\n');
  const chunkSize = 50; // 每 50 行一个片段

  for (let i = 0; i < lines.length; i += chunkSize) {
    const end = Math.min(i + chunkSize, lines.length);
    const chunkLines = lines.slice(i, end);
    snippets.push({
      id: `chunk-${i}-${end}`,
      type: 'other',
      content: chunkLines.join('\n'),
      lineRange: [i + 1, end],
      relevanceScore: 0,
      keywords: [],
    });
  }

  return snippets;
}

/**
 * 提取代码块
 */
function extractCodeBlock(code: string, start: number, end: number): string {
  const lines = code.split('\n');
  const startLine = code.substring(0, start + 1).split('\n').length;
  const endLine = code.substring(0, end + 1).split('\n').length;

  // 获取完整的内容，包括适当的缩进
  const blockLines = lines.slice(startLine - 1, endLine);
  return blockLines.join('\n');
}

// ==================== 相关性计算 ====================

/**
 * 计算片段相关性
 */
function calculateRelevance(snippet: CodeSnippet, keywords: string[], query: string): number {
  let score = 0;
  const content = snippet.content.toLowerCase();
  const queryLower = query.toLowerCase();

  // 1. 名称匹配（最高权重）
  if (snippet.name) {
    for (const keyword of keywords) {
      if (keyword.toLowerCase() === snippet.name.toLowerCase()) {
        score += 0.5; // 完全匹配
      } else if (snippet.name.toLowerCase().includes(keyword.toLowerCase())) {
        score += 0.3; // 部分匹配
      }
    }
  }

  // 2. 关键词匹配
  for (const keyword of keywords) {
    const keywordLower = keyword.toLowerCase();
    if (content.includes(keywordLower)) {
      score += 0.2;
      // 多次出现增加分数
      const matches = (content.match(new RegExp(keywordLower, 'g')) || []).length;
      score += Math.min(matches * 0.05, 0.3); // 最多加 0.3
    }
  }

  // 3. 查询字符串模糊匹配
  if (content.includes(queryLower)) {
    score += 0.3;
  }

  // 4. 片段长度惩罚（太长或太短都不好）
  const length = snippet.lineRange[1] - snippet.lineRange[0];
  if (length < 5) score -= 0.1;
  if (length > 100) score -= 0.2;

  // 确保分数在 0-1 之间
  return Math.max(0, Math.min(1, score));
}

// ==================== 上下文添加 ====================

/**
 * 为片段添加上下文
 */
function addContext(snippet: CodeSnippet, code: string, contextLines: number): CodeSnippet {
  const lines = code.split('\n');
  const [startLine, endLine] = snippet.lineRange;

  // 计算实际边界
  const contextStart = Math.max(1, startLine - contextLines);
  const contextEnd = Math.min(lines.length, endLine + contextLines);

  // 提取带上下文的代码
  const contextLinesArray = lines.slice(contextStart - 1, contextEnd);

  return {
    ...snippet,
    content: contextLinesArray.join('\n'),
    lineRange: [contextStart, contextEnd],
  };
}

// ==================== 去重 ====================

/**
 * 去除重复或高度重叠的片段
 */
function deduplicateSnippets(snippets: CodeSnippet[]): CodeSnippet[] {
  if (snippets.length <= 1) return snippets;

  const result: CodeSnippet[] = [];

  for (const snippet of snippets) {
    const isDuplicate = result.some(existing =>
      isOverlapping(snippet, existing)
    );

    if (!isDuplicate) {
      result.push(snippet);
    }
  }

  return result;
}

/**
 * 检查两个片段是否重叠
 */
function isOverlapping(a: CodeSnippet, b: CodeSnippet): boolean {
  // 如果类型和名称都相同，认为是重复的
  if (a.type === b.type && a.name === b.name && a.name) {
    return true;
  }

  // 检查行范围重叠
  const [aStart, aEnd] = a.lineRange;
  const [bStart, bEnd] = b.lineRange;

  return !(aEnd < bStart || bEnd < aStart);
}

// ==================== 回退策略 ====================

/**
 * 创建回退片段（当没有匹配时返回）
 */
function createFallbackSnippet(code: string): CodeSnippet {
  const lines = code.split('\n');
  const headLines = lines.slice(0, 30);
  const tailLines = lines.slice(-30);

  const content = [
    '// === 文件头部 ===',
    headLines.join('\n'),
    '\n',
    '// === 文件尾部 ===',
    tailLines.join('\n'),
  ].join('\n');

  return {
    id: 'fallback',
    type: 'other',
    content,
    lineRange: [1, lines.length],
    relevanceScore: 0,
    keywords: [],
  };
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
 * 检测文件语言
 */
export function detectLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return LANGUAGE_EXTENSION_MAP[ext] || 'javascript';
}
