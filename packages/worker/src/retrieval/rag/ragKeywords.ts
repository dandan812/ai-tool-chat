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

/**
 * 关键词提取独立出来，是为了把“用户问题如何变成检索意图”单独讲清楚。
 * 新人读 RAG 主入口时，只需要知道这里会把自然语言问题压缩成一组检索词。
 */
export function extractKeywords(query: string): string[] {
  const keywords: string[] = [];
  const lowerQuery = query.toLowerCase();

  for (const keyword of CODE_QUERY_KEYWORDS) {
    if (lowerQuery.includes(keyword)) {
      keywords.push(keyword);
    }
  }

  for (const keyword of CHINESE_QUERY_KEYWORDS) {
    if (query.includes(keyword)) {
      keywords.push(keyword);
    }
  }

  const identifiers = query.match(IDENTIFIER_PATTERN);
  if (identifiers) {
    keywords.push(...identifiers);
  }

  const quoted = query.match(QUOTED_PATTERN);
  if (quoted) {
    keywords.push(...quoted.map((value) => value.replace(/['"`]/g, '')));
  }

  return [...new Set(keywords)];
}
