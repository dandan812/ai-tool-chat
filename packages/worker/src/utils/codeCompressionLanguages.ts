import type { LanguageConfig } from './codeCompressionTypes';

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
    multiLineComment: [/"""/g, /"""/g],
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

const LANGUAGE_ALIAS_MAP: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
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

export function getLanguageConfig(language: string): LanguageConfig | null {
  const key = LANGUAGE_ALIAS_MAP[language.toLowerCase()] || language.toLowerCase();
  return LANGUAGE_CONFIGS[key] || null;
}
