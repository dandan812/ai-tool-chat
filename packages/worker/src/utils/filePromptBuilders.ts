import type { Message } from '../types';

interface TokenSummary {
  totalOriginalTokens: number;
  totalProcessedTokens: number;
  reductionRatio: number;
}

interface TextRetrievalSummary extends TokenSummary {
  selectedChunkCount: number;
  budgetExceeded: boolean;
}

const CHUNK_SUMMARY_PROMPT = `请分析以下文件片段，提取其核心内容和结构。返回格式：
1. 主要内容/功能概述
2. 关键概念/术语
3. 重要数据/配置项

文件片段：`;

function buildFinalAnswerPrompt(summaries: string, userQuestion: string): string {
  return `我有一个大文件，已经分块分析。以下是各分块的摘要：

${summaries}

用户的问题是：${userQuestion}

请基于以上摘要回答用户问题。`;
}

export function createSmallFileMessages(fileContents: string, userQuestion: string): Message[] {
  return [
    {
      role: 'system',
      content: '你是一个文件分析助手。用户会上传一些文本文件，请根据文件内容回答用户的问题。',
    },
    {
      role: 'user',
      content: `以下是我上传的文件内容：\n\n${fileContents}\n\n我的问题是：${userQuestion}`,
    },
  ];
}

export function createTextRetrievalMessages(
  retrievedContent: string,
  userQuestion: string,
  summary: TextRetrievalSummary,
): Message[] {
  const savedTokens = Math.max(summary.totalOriginalTokens - summary.totalProcessedTokens, 0);

  return [
    {
      role: 'system',
      content: `你是一个文本文件分析助手。系统已经先对大文件做了检索，只保留了与问题最相关的文本片段。

原始文件大小: ${summary.totalOriginalTokens} tokens
注入模型大小: ${summary.totalProcessedTokens} tokens
节省 Token: ${savedTokens}
选中片段数: ${summary.selectedChunkCount}
${summary.budgetExceeded ? '由于预算限制，部分相关片段未注入。' : '当前片段已覆盖主要相关内容。'}

请只基于提供的片段回答问题。如果信息不足，请明确说明，并建议用户缩小范围、指定章节、关键词或段落。`,
    },
    {
      role: 'user',
      content: `以下是系统检索到的相关文件片段：\n\n${retrievedContent}\n\n我的问题是：${userQuestion}`,
    },
  ];
}

export function createTextOverviewMessages(
  retrievedContent: string,
  userQuestion: string,
  summary: TextRetrievalSummary,
): Message[] {
  return [
    {
      role: 'system',
      content: `你是一个文本文件分析助手。用户的问题更偏向整体概览，因此系统没有通读全文，而是从整份文件中抽取了具有代表性的片段。

原始文件大小: ${summary.totalOriginalTokens} tokens
注入模型大小: ${summary.totalProcessedTokens} tokens
代表性片段数: ${summary.selectedChunkCount}
${summary.budgetExceeded ? '片段数量受预算限制，回答时请明确说明可能存在遗漏。' : '片段已覆盖文件的多个位置。'}

请基于这些代表性片段给出整体层面的概览、主题、结构和重点。如果无法确定某个细节，请明确说明该结论只是基于抽样片段。`,
    },
    {
      role: 'user',
      content: `以下是从整份文件不同位置抽取的代表性片段：\n\n${retrievedContent}\n\n我的问题是：${userQuestion}`,
    },
  ];
}

export function createTextRetrievalNarrowScopeMessage(
  fileCount: number,
  totalTokens: number,
): string {
  return `这次没有检索到足够相关的文件片段，当前文件总规模约 ${totalTokens} tokens，共 ${fileCount} 个文件。为了避免高成本地通读全文，请把问题缩小到更具体的章节、关键词、人物、时间点或段落。`;
}

export function createLargeFileAnswerMessages(
  summaries: string[],
  userQuestion: string,
): Message[] {
  return [
    {
      role: 'system',
      content:
        '你是一个文件分析助手。用户上传了一个大文件，已经分块提取了摘要。请基于这些摘要回答用户问题。',
    },
    {
      role: 'user',
      content: buildFinalAnswerPrompt(
        summaries.map((summary, index) => `### 分块 ${index + 1} 摘要:\n${summary}`).join('\n\n'),
        userQuestion,
      ),
    },
  ];
}

export function createChunkSummaryMessages(chunk: string): Message[] {
  return [
    {
      role: 'system',
      content:
        '你是一个文件分析助手。用户上传了一个大文件，已经分块。请提取当前分块的核心内容和结构。',
    },
    {
      role: 'user',
      content: `${CHUNK_SUMMARY_PROMPT}\n\n${chunk}`,
    },
  ];
}

export function createRagMessages(
  codeContent: string,
  userQuestion: string,
  summary: TokenSummary,
): Message[] {
  return [
    {
      role: 'system',
      content: `你是一个代码分析助手。用户上传了代码文件，系统已使用智能检索技术，根据用户问题筛选了最相关的代码片段。

原始代码总大小: ${summary.totalOriginalTokens} tokens
检索后大小: ${summary.totalProcessedTokens} tokens
Token 节省率: ${(summary.reductionRatio * 100).toFixed(1)}%

请基于以下检索到的代码片段回答用户问题。如果信息不足，请告知用户需要查看更多代码。`,
    },
    {
      role: 'user',
      content: `${codeContent}\n\n我的问题是：${userQuestion}`,
    },
  ];
}

export function createMixedFileMessages(
  fileContents: string,
  userQuestion: string,
  summary: TokenSummary,
): Message[] {
  return [
    {
      role: 'system',
      content: `你是一个文件分析助手。用户上传了混合类型的文件（代码和文本）。

代码文件已使用智能压缩技术，只保留关键结构（函数签名、类定义等）。
原始代码总大小: ${summary.totalOriginalTokens} tokens
处理后大小: ${summary.totalProcessedTokens} tokens
Token 节省率: ${(summary.reductionRatio * 100).toFixed(1)}%

请基于以下文件内容回答用户问题。`,
    },
    {
      role: 'user',
      content: `以下是我上传的文件内容：\n\n${fileContents}\n\n我的问题是：${userQuestion}`,
    },
  ];
}
