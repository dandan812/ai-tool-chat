import type { SkillStreamChunk } from '../types';

/**
 * 解析 OpenAI 兼容格式的 SSE 数据行。
 * 文本、多模态和 GLM 都复用这套格式解析。
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
    const content =
      json.choices?.[0]?.delta?.content ??
      json.choices?.[0]?.message?.content ??
      json.content ??
      json.data?.content;

    if (content !== undefined && content !== null && content !== '') {
      return { type: 'content', content: String(content) };
    }
  } catch {
    return null;
  }

  return null;
}
