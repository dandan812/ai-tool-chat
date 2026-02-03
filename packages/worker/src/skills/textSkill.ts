/**
 * 文本 Skill - 基于 DeepSeek
 * 处理纯文本对话
 */
import type { Skill, SkillInput, SkillContext, SkillStreamChunk, Message } from '../types';
import { logger } from '../utils/logger';

export const textSkill: Skill = {
  name: 'text-chat',
  type: 'text',
  description: '基于 DeepSeek 的文本对话技能',

  async *execute(input: SkillInput, context: SkillContext): AsyncIterable<SkillStreamChunk> {
    const { env } = context;
    const { messages, temperature = 0.7 } = input;

    try {
      logger.info('Calling DeepSeek API', { messageCount: messages.length });

      const response = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: messages as Message[],
          stream: true,
          temperature,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        logger.error('DeepSeek API error', { status: response.status, error });
        yield { type: 'error', error: `DeepSeek API Error: ${error}` };
        return;
      }

      if (!response.body) {
        yield { type: 'error', error: 'Response body is null' };
        return;
      }

      // 流式读取响应 - 逐字传递给前端
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let chunkCount = 0;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          // 逐行处理，确保流式传递
          for (const line of lines) {
            const chunk = parseSSELine(line);
            if (chunk && chunk.type === 'content') {
              chunkCount++;
              logger.debug(`Yielding content chunk #${chunkCount}: "${chunk.content?.slice(0, 20)}..."`);
              yield chunk;
            } else if (chunk && chunk.type === 'error') {
              yield chunk;
            }
          }
        }

        // 处理剩余数据
        if (buffer.trim()) {
          const chunk = parseSSELine(buffer.trim());
          if (chunk) {
            logger.debug(`Yielding final chunk: "${chunk.content?.slice(0, 20)}..."`);
            yield chunk;
          }
        }
      } finally {
        reader.releaseLock();
      }

      yield { type: 'complete' };
      logger.info('DeepSeek API streaming completed', { totalChunks: chunkCount });

    } catch (error) {
      logger.error('DeepSeek API request failed', error);
      yield { type: 'error', error: String(error) };
    }
  },
};

/**
 * 解析 SSE 数据行
 */
function parseSSELine(line: string): SkillStreamChunk | null {
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
    const content = json.choices?.[0]?.delta?.content;
    
    if (content !== undefined && content !== null) {
      return { type: 'content', content: String(content) };
    }
  } catch {
    // 忽略解析错误
  }

  return null;
}
