export interface CodeSnippet {
  id: string;
  type: 'function' | 'class' | 'variable' | 'import' | 'comment' | 'other';
  name?: string;
  content: string;
  lineRange: [number, number];
  relevanceScore: number;
  keywords: string[];
}

export interface RetrievalResult {
  query: string;
  extractedKeywords: string[];
  matchedSnippets: CodeSnippet[];
  totalLines: number;
  selectedLines: number;
  coverageRatio: number;
}

export interface RetrievalOptions {
  maxSnippets?: number;
  contextLines?: number;
  minRelevance?: number;
  includeImports?: boolean;
  includeComments?: boolean;
}

export interface LanguagePattern {
  function: RegExp;
  class: RegExp;
  variable: RegExp;
  import: RegExp;
  export: RegExp;
  comment: RegExp;
}
