import type {
  ClassInfo,
  CodeStructure,
  FunctionInfo,
  LanguageConfig,
  VariableInfo,
} from './codeCompressionTypes';

export function extractCodeStructures(code: string, config: LanguageConfig): CodeStructure {
  return {
    functions: extractFunctions(code, config),
    classes: extractClasses(code, config),
    variables: config.variablePattern ? extractVariables(code, config) : [],
  };
}

function extractFunctions(code: string, config: LanguageConfig): FunctionInfo[] {
  const functions: FunctionInfo[] = [];
  const regex = new RegExp(config.functionPattern.source, 'g');
  let match: RegExpExecArray | null;

  while ((match = regex.exec(code)) !== null) {
    const name = match[1] || match[2];
    if (!name) {
      continue;
    }

    const startPos = match.index;
    let endPos = code.indexOf('{', startPos);
    if (endPos === -1) {
      endPos = code.indexOf(':', startPos);
      if (endPos === -1) {
        continue;
      }
    }

    const signature = code.substring(startPos, endPos + 1).trim();
    const startLine = code.substring(0, startPos + 1).split('\n').length;
    const bodyEnd = findMatchingBrace(code, endPos);
    const bodyCode = code.substring(endPos + 1, bodyEnd !== -1 ? bodyEnd : code.length);
    const bodyLines = bodyCode.split('\n').length;

    functions.push({
      name,
      signature,
      lineRange: [startLine, startLine + bodyLines],
      bodyLines,
      hasReturn: /return\s+[^\n;]+/.test(bodyCode),
      hasAsync: /async/.test(signature),
    });
  }

  return functions;
}

function extractClasses(code: string, config: LanguageConfig): ClassInfo[] {
  const classes: ClassInfo[] = [];
  const regex = new RegExp(config.classPattern.source, 'g');
  let match: RegExpExecArray | null;

  while ((match = regex.exec(code)) !== null) {
    const name = match[1] || match[2];
    if (!name) {
      continue;
    }

    const startPos = match.index;
    const startLine = code.substring(0, startPos + 1).split('\n').length;
    const bodyStart = code.indexOf('{', startPos);
    if (bodyStart === -1) {
      continue;
    }

    const bodyEnd = findMatchingBrace(code, bodyStart);
    const bodyCode = code.substring(bodyStart + 1, bodyEnd !== -1 ? bodyEnd : code.length);
    const methods: string[] = [];
    const methodRegex = new RegExp(config.functionPattern.source, 'g');
    let methodMatch: RegExpExecArray | null;

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

function extractVariables(code: string, config: LanguageConfig): VariableInfo[] {
  const variables: VariableInfo[] = [];
  if (!config.variablePattern) {
    return variables;
  }

  const regex = new RegExp(config.variablePattern.source, 'g');
  let match: RegExpExecArray | null;

  while ((match = regex.exec(code)) !== null) {
    const name = match[1];
    if (!name || config.keywords.includes(name)) {
      continue;
    }

    const startPos = match.index;
    variables.push({
      name,
      declaration: match[0],
      line: code.substring(0, startPos + 1).split('\n').length,
    });
  }

  return variables;
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
