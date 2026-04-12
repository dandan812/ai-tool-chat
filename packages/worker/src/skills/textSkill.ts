/**
 * 文本 Skill
 *
 * 作用：处理纯文本对话。
 * 当前项目已经明确收口到阿里云百炼，因此这里不再承担多供应商分发职责，
 * 只负责把输入交给百炼兼容 provider，并在失败时统一兜底。
 */
import type { Skill, SkillInput, SkillContext, SkillStreamChunk, Message } from '../types';
import { logger } from '../infrastructure/logger';
import {
  executeTextProviderStream,
  resolveTextProvider,
} from '../providers/textProvider';

export const textSkill: Skill = {
  name: 'text-chat',
  type: 'text',
  description: '基于阿里云百炼兼容接口的文本对话技能',

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
