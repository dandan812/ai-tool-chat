export interface LanguageConfig {
  name: string;
  singleLineComment: RegExp;
  multiLineComment: [RegExp, RegExp];
  functionPattern: RegExp;
  classPattern: RegExp;
  variablePattern?: RegExp;
  keywords: string[];
}

export interface CompressResult {
  compressedCode: string;
  stats: {
    originalLines: number;
    compressedLines: number;
    originalTokens: number;
    compressedTokens: number;
    reductionRatio: number;
    functionsFound: number;
    classesFound: number;
  };
}

export interface CodeStructure {
  functions: FunctionInfo[];
  classes: ClassInfo[];
  variables: VariableInfo[];
}

export interface FunctionInfo {
  name: string;
  signature: string;
  lineRange: [number, number];
  bodyLines: number;
  hasReturn: boolean;
  hasAsync: boolean;
}

export interface ClassInfo {
  name: string;
  declaration: string;
  lineRange: [number, number];
  methods: string[];
}

export interface VariableInfo {
  name: string;
  declaration: string;
  line: number;
}
