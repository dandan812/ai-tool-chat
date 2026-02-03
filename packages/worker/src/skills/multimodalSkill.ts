/**
 * 多模态 Skill - 基于 Qwen-VL
 * 处理图文对话
 */
import type {
  Skill,
  SkillInput,
  SkillContext,
  SkillStreamChunk,
  Message,
  ImageData,
} from '../types';
import { logger } from '../utils/logger';

export const multimodalSkill: Skill = {
  name: 'multimodal-chat',
  type: 'multimodal',
  description: '基于 Qwen-VL 的图文对话技能',

  async *execute(
    input: SkillInput,
    context: SkillContext
  ): AsyncIterable<SkillStreamChunk> {
    const { env } = context;
    const { messages, images = [], temperature = 0.7 } = input;

    if (!env.QWEN_API_KEY) {
      yield { type: 'error', error: 'QWEN_API_KEY not configured' };
      return;
    }

    try {
      logger.info('Calling Qwen API', { imageCount: images.length });

      // 构建 Qwen-VL 格式的消息
      const qwenMessages = buildQwenMessages(messages, images);

      const response = await fetch(
        'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${env.QWEN_API_KEY}`,
          },
          body: JSON.stringify({
            model: 'qwen-vl-plus',
            messages: qwenMessages,
            stream: true,
            temperature,
          }),
        }
      );

      if (!response.ok) {
        const error = await response.text();
        logger.error('Qwen API error', { status: response.status, error });
        yield { type: 'error', error: `Qwen API Error: ${error}` };
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

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          // 逐行处理，确保流式传递
          for (const line of lines) {
            const chunk = parseQwenSSELine(line);
            if (chunk) {
              yield chunk;
            }
          }
        }

        // 处理剩余数据
        if (buffer.trim()) {
          const chunk = parseQwenSSELine(buffer.trim());
          if (chunk) {
            yield chunk;
          }
        }
      } finally {
        reader.releaseLock();
      }

      yield { type: 'complete' };
      logger.info('Qwen API streaming completed');

    } catch (error) {
      logger.error('Qwen API request failed', error);
      yield { type: 'error', error: String(error) };
    }
  },
};

/**
 * 构建 Qwen-VL 格式的消息
 * 使用 OpenAI 兼容格式
 */
function buildQwenMessages(
  messages: Message[],
  images: ImageData[]
): unknown[] {
  return messages.map((msg) => {
    if (msg.role === 'user' && images.length > 0) {
      // 多模态消息格式 - OpenAI 兼容格式
      const content: unknown[] = [];

      // 添加图片
      for (const img of images) {
        content.push({
          type: 'image_url',
          image_url: {
            url: `data:${img.mimeType};base64,${img.base64}`,
          },
        });
      }

      // 添加文本
      content.push({
        type: 'text',
        text: msg.content || '请描述这张图片',
      });

      return {
        role: msg.role,
        content,
      };
    }

    // 纯文本消息
    return {
      role: msg.role,
      content: msg.content,
    };
  });
}

/**
 * 解析 Qwen SSE 数据行
 */
function parseQwenSSELine(line: string): SkillStreamChunk | null {
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
    // OpenAI 兼容格式的响应
    const content =
      json.choices?.[0]?.delta?.content ||
      json.choices?.[0]?.message?.content;

    if (content) {
      return { type: 'content', content };
    }
  } catch {
    // 忽略解析错误
  }

  return null;
}
