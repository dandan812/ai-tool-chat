import { LANGUAGE_PATTERNS, detectLanguage } from './ragLanguage';
import type { CodeSnippet } from './ragTypes';

export { detectLanguage };

export function parseCodeToSnippets(code: string, language: string): CodeSnippet[] {
  const snippets: CodeSnippet[] = [];
  const pattern = LANGUAGE_PATTERNS[language.toLowerCase()];

  if (!pattern) {
    return createLineBasedSnippets(code);
  }

  let match: RegExpExecArray | null;
  const functionRegex = new RegExp(pattern.function.source, 'g');
  while ((match = functionRegex.exec(code)) !== null) {
    const name = match[1] || match[2];
    if (!name) {
      continue;
    }

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

  const classRegex = new RegExp(pattern.class.source, 'g');
  while ((match = classRegex.exec(code)) !== null) {
    const name = match[1] || match[2];
    if (!name) {
      continue;
    }

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

function createLineBasedSnippets(code: string): CodeSnippet[] {
  const snippets: CodeSnippet[] = [];
  const lines = code.split('\n');
  const chunkSize = 50;

  for (let index = 0; index < lines.length; index += chunkSize) {
    const end = Math.min(index + chunkSize, lines.length);
    snippets.push({
      id: `chunk-${index}-${end}`,
      type: 'other',
      content: lines.slice(index, end).join('\n'),
      lineRange: [index + 1, end],
      relevanceScore: 0,
      keywords: [],
    });
  }

  return snippets;
}

function extractCodeBlock(code: string, start: number, end: number): string {
  const lines = code.split('\n');
  const startLine = code.substring(0, start + 1).split('\n').length;
  const endLine = code.substring(0, end + 1).split('\n').length;
  return lines.slice(startLine - 1, endLine).join('\n');
}

function findMatchingBrace(code: string, startPos: number): number {
  let depth = 1;
  let position = startPos + 1;

  while (position < code.length && depth > 0) {
    const char = code[position];
    if (char === '{') depth++;
    else if (char === '}') depth--;
    position++;
  }

  return depth === 0 ? position - 1 : -1;
}
