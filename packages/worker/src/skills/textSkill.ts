/**
 * 文本 Skill
 *
 * 作用：处理纯文本对话
 * 优先级：
 *   1. 如果显式指定 OpenAI 模型，走 OpenAI
 *   2. 如果显式指定 DeepSeek 模型，走 DeepSeek
 *   3. 如果显式指定 Qwen 模型，走阿里云百炼
 *   4. 如果只配置了 OpenAI Key，走 OpenAI
 *   5. 如果只配置了 Qwen Key，走阿里云百炼
 *   6. 否则走 DeepSeek
 */
import type { Skill, SkillInput, SkillContext, SkillStreamChunk, Message } from '../types';
import { logger } from '../utils/logger';

type TextProvider = 'openai' | 'deepseek' | 'qwen';

interface ProviderConfig {
  provider: TextProvider;
  model: string;
  url: string;
  apiKey: string;
}

function resolveProvider(input: SkillInput, context: SkillContext): ProviderConfig | null {
  const requestedModel = typeof input.model === 'string' ? input.model : '';
  const { env } = context;

  if ((requestedModel.startsWith('gpt-') || requestedModel.startsWith('o')) && env.OPENAI_API_KEY) {
    return {
      provider: 'openai',
      model: requestedModel,
      url: 'https://api.openai.com/v1/chat/completions',
      apiKey: env.OPENAI_API_KEY,
    };
  }

  if (requestedModel.startsWith('deepseek') && env.DEEPSEEK_API_KEY) {
    return {
      provider: 'deepseek',
      model: requestedModel,
      url: 'https://api.deepseek.com/chat/completions',
      apiKey: env.DEEPSEEK_API_KEY,
    };
  }

  if (requestedModel.startsWith('qwen') && env.QWEN_API_KEY) {
    return {
      provider: 'qwen',
      model: requestedModel,
      url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      apiKey: env.QWEN_API_KEY,
    };
  }

  if (env.OPENAI_API_KEY && !env.DEEPSEEK_API_KEY) {
    return {
      provider: 'openai',
      model: 'gpt-4.1-mini',
      url: 'https://api.openai.com/v1/chat/completions',
      apiKey: env.OPENAI_API_KEY,
    };
  }

  if (env.DEEPSEEK_API_KEY) {
    return {
      provider: 'deepseek',
      model: 'deepseek-chat',
      url: 'https://api.deepseek.com/chat/completions',
      apiKey: env.DEEPSEEK_API_KEY,
    };
  }

  if (env.QWEN_API_KEY) {
    return {
      provider: 'qwen',
      model: 'qwen3-max-2026-01-23',
      url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      apiKey: env.QWEN_API_KEY,
    };
  }

  if (env.OPENAI_API_KEY) {
    return {
      provider: 'openai',
      model: 'gpt-4.1-mini',
      url: 'https://api.openai.com/v1/chat/completions',
      apiKey: env.OPENAI_API_KEY,
    };
  }

  return null;
}

export const textSkill: Skill = {
  name: 'text-chat',
  type: 'text',
  description: '基于 OpenAI / DeepSeek / Qwen 的文本对话技能',

  async *execute(input: SkillInput, context: SkillContext): AsyncIterable<SkillStreamChunk> {
    const { messages, temperature = 0.7 } = input;
    const providerConfig = resolveProvider(input, context);

    if (!providerConfig) {
      yield { type: 'error', error: '未配置可用的文本模型 API Key' };
      return;
    }

    try {
      logger.info('Calling text provider API', {
        provider: providerConfig.provider,
        model: providerConfig.model,
        messageCount: messages.length,
      });

      const response = await fetch(providerConfig.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${providerConfig.apiKey}`,
        },
        body: JSON.stringify({
          model: providerConfig.model,
          messages: messages as Message[],
          stream: true,
          temperature,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        logger.error('Text provider API error', {
          provider: providerConfig.provider,
          model: providerConfig.model,
          status: response.status,
          error,
        });
        yield {
          type: 'error',
          error: `${providerConfig.provider.toUpperCase()} API Error (Status ${response.status}): ${error}`,
        };
        return;
      }

      if (!response.body) {
        yield { type: 'error', error: 'Response body is null' };
        return;
      }

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

          for (const line of lines) {
            const chunk = parseSSELine(line);
            if (chunk && chunk.type === 'content') {
              chunkCount++;
              yield chunk;
            } else if (chunk && chunk.type === 'error') {
              yield chunk;
            }
          }
        }

        if (buffer.trim()) {
          const chunk = parseSSELine(buffer.trim());
          if (chunk) {
            yield chunk;
          }
        }
      } finally {
        reader.releaseLock();
      }

      yield { type: 'complete' };
      logger.info('Text provider streaming completed', {
        provider: providerConfig.provider,
        model: providerConfig.model,
        totalChunks: chunkCount,
      });
    } catch (error) {
      logger.error('Text provider request failed', error);
      yield { type: 'error', error: String(error) };
    }
  },
};

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
