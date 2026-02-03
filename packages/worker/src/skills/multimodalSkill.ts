/**
 * 多模态 Skill - 基于 Qwen-VL (通义千问视觉大模型)
 * 
 * 作用：处理图文对话，支持用户上传图片让 AI 分析
 * 特点：
 *   - 使用阿里云的 Qwen-VL 模型
 *   - 支持 Base64 编码的图片传输
 *   - 同样支持流式响应
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

/**
 * 多模态技能定义
 * 可以处理图片+文本的混合输入
 */
export const multimodalSkill: Skill = {
  name: 'multimodal-chat',    // 技能名
  type: 'multimodal',         // 技能类型：多模态（图文）
  description: '基于 Qwen-VL 的图文对话技能',

  /**
   * 执行多模态对话
   * 与 textSkill 类似，但多了图片处理逻辑
   */
  async *execute(
    input: SkillInput,
    context: SkillContext
  ): AsyncIterable<SkillStreamChunk> {
    const { env } = context;
    const { messages, images = [], temperature = 0.7 } = input;

    // 检查必要的 API Key 是否配置
    if (!env.QWEN_API_KEY) {
      yield { type: 'error', error: 'QWEN_API_KEY not configured' };
      return;
    }

    try {
      logger.info('Calling Qwen API', { imageCount: images.length });

      /**
       * 构建 Qwen-VL 格式的消息
       * 
       * Qwen 使用 OpenAI 兼容的消息格式，但内容可以是数组（包含图片和文本）
       * 示例：
       * {
       *   role: 'user',
       *   content: [
       *     { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,xxx' } },
       *     { type: 'text', text: '描述这张图片' }
       *   ]
       * }
       */
      const qwenMessages = buildQwenMessages(messages, images);

      // 调用 Qwen API
      const response = await fetch(
        'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${env.QWEN_API_KEY}`,
          },
          body: JSON.stringify({
            model: 'qwen-vl-plus',    // Qwen 视觉模型
            messages: qwenMessages,   // 构建好的消息列表
            stream: true,
            temperature,
          }),
        }
      );

      // 错误处理
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

      /**
       * 流式读取响应
       * 逻辑与 textSkill 相同
       */
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
 * 
 * 将标准消息格式转换为 Qwen 支持的多模态格式
 * 关键：如果有图片，将消息内容转为数组，包含 image_url 和 text
 * 
 * @param messages - 原始消息列表
 * @param images - 用户上传的图片数组
 * @returns 转换后的消息格式
 */
function buildQwenMessages(
  messages: Message[],
  images: ImageData[]
): unknown[] {
  return messages.map((msg) => {
    // 只有用户消息且包含图片时才需要特殊处理
    if (msg.role === 'user' && images.length > 0) {
      // 内容数组，可以包含多个图片和一段文本
      const content: unknown[] = [];

      // 1. 先添加所有图片（Base64 格式）
      for (const img of images) {
        content.push({
          type: 'image_url',
          image_url: {
            // Base64 图片 URL 格式：data:image/jpeg;base64,xxxxx
            url: `data:${img.mimeType};base64,${img.base64}`,
          },
        });
      }

      // 2. 再添加文本内容
      content.push({
        type: 'text',
        text: msg.content || '请描述这张图片',  // 默认提示词
      });

      // 返回多模态消息格式
      return {
        role: msg.role,
        content,
      };
    }

    // 纯文本消息保持原样
    return {
      role: msg.role,
      content: msg.content,
    };
  });
}

/**
 * 解析 Qwen 的 SSE 数据行
 * 
 * 与 DeepSeek 类似，但响应格式可能略有不同
 * 兼容两种格式：
 *   - 流式：choices[0].delta.content
 *   - 非流式：choices[0].message.content
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
    
    // 兼容两种可能的字段路径
    const content =
      json.choices?.[0]?.delta?.content ||      // 流式格式
      json.choices?.[0]?.message?.content;     // 完整消息格式

    if (content) {
      return { type: 'content', content };
    }
  } catch {
    // 忽略解析错误
  }

  return null;
}
