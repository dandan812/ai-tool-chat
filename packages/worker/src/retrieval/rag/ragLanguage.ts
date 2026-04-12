import type { LanguagePattern } from './ragTypes';

export const LANGUAGE_PATTERNS: Record<string, LanguagePattern> = {
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
    export: null as never,
    comment: /#.*|"""[\s\S]*?"""|'''[\s\S]*?'''/g,
  },
  java: {
    function: /(?:\w+)\s+(\w+)\s*\([^)]*\)\s*(?:throws\s+\w+)?\s*\{/g,
    class: /class\s+(\w+)/g,
    variable: /(?:\w+)\s+(\w+)\s*=/g,
    import: /import\s+[\w.]+;/g,
    export: null as never,
    comment: /\/\/.*|\/\*[\s\S]*?\*\//g,
  },
  go: {
    function: /func\s+(?:\(\w+\s+\*?\w+\)\s+)?(\w+)\s*\(/g,
    class: /type\s+(\w+)\s+struct/g,
    variable: /(\w+)\s*:=?/g,
    import: /import\s+['"](.*?)['"]/g,
    export: null as never,
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
    export: null as never,
    comment: /\/\/.*|\/\*[\s\S]*?\*\//g,
  },
  cpp: {
    function: /(?:\w+::)?(\w+)\s*\([^)]*\)(?:\s*(?:const)?)?\s*\{/g,
    class: /class\s+(\w+)/g,
    variable: /(?:\w+)\s+(\w+)\s*=/g,
    import: /#include\s+<[\w.]+>|#include\s+"[\w.]+"/g,
    export: null as never,
    comment: /\/\/.*|\/\*[\s\S]*?\*\//g,
  },
};

const LANGUAGE_EXTENSION_MAP: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  java: 'java',
  go: 'go',
  rs: 'rust',
  c: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  h: 'c',
  hpp: 'cpp',
};

export function detectLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return LANGUAGE_EXTENSION_MAP[ext] || 'javascript';
}
