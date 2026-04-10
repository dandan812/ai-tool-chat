/**
 * 文本 Skill
 *
 * 作用：处理纯文本对话。
 * 当前项目主路径优先使用阿里云百炼（Qwen），
 * 但依然保留 OpenAI / DeepSeek 的兼容能力。
 */
import type { Skill, SkillInput, SkillContext, SkillStreamChunk, Message } from '../types';
import { logger } from '../utils/logger';
import {
  executeTextProviderStream,
  resolveTextProvider,
} from '../providers/textProvider';

export const textSkill: Skill = {
  name: 'text-chat',
  type: 'text',
  description: '基于 OpenAI / DeepSeek / Qwen 的文本对话技能',

  async *execute(input: SkillInput, context: SkillContext): AsyncIterable<SkillStreamChunk> {
    const { messages, temperature = 0.7 } = input;
    const providerConfig = resolveTextProvider(input, context);

    if (!providerConfig) {
      yield { type: 'error', error: '未配置可用的文本模型 API Key' };
      return;
    }

    try {
      yield* executeTextProviderStream(
        providerConfig,
        messages as Message[],
        temperature,
      );
    } catch (error) {
      logger.error('Text provider request failed', error);
      yield { type: 'error', error: String(error) };
    }
  },
};
