import type { SkillStreamChunk } from '../types';

function extractTextFromContentPart(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  if (!content || typeof content !== 'object') {
    return '';
  }

  const candidate = content as Record<string, unknown>;

  if (typeof candidate.text === 'string') {
    return candidate.text;
  }

  if (typeof candidate.content === 'string') {
    return candidate.content;
  }

  return '';
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => extractTextFromContentPart(part))
      .filter(Boolean)
      .join('');
  }

  return extractTextFromContentPart(content);
}

/**
 * 解析 OpenAI 兼容格式的 SSE 数据行。
 * 当前项目里的百炼文本和百炼多模态都复用这套格式解析。
 */
export function parseChatCompletionSSELine(line: string): SkillStreamChunk | null {
  const trimmed = line.trim();

  if (!trimmed || !trimmed.startsWith('data: ')) {
    return null;
  }

  const data = trimmed.slice(6);
  if (data === '[DONE]') {
    return null;
  }

  try {
    const json = JSON.parse(data);
    const contentCandidate =
      json.choices?.[0]?.delta?.content ??
      json.choices?.[0]?.delta?.text ??
      json.choices?.[0]?.delta?.reasoning_content ??
      json.choices?.[0]?.message?.content ??
      json.choices?.[0]?.message?.text ??
      json.output?.text ??
      json.output_text ??
      json.content ??
      json.data?.content ??
      json.data?.text;
    const content = extractTextFromContent(contentCandidate);

    if (content !== undefined && content !== null && content !== '') {
      return { type: 'content', content: String(content) };
    }
  } catch {
    return null;
  }

  return null;
}
