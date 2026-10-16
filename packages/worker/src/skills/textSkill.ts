/**
 * 文本 Skill
 *
 * 作用：处理纯文本对话。
 * 把输入交给部署配置的兼容 provider，复用流式响应和任务预算。
 */
import type { Skill, SkillInput, SkillContext, SkillStreamChunk, Message } from '../types'
import { executeTextProviderStream, resolveTextProvider } from '../providers/textProvider'

export const textSkill: Skill = {
  name: 'text-chat',
  type: 'text',
  description: '基于兼容接口的文本对话技能',

  async *execute(input: SkillInput, context: SkillContext): AsyncIterable<SkillStreamChunk> {
    const { messages, temperature = 0.7 } = input
    const providerConfig = resolveTextProvider(input, context)

    if (!providerConfig) {
      yield { type: 'error', error: '未配置可用的文本模型 API Key' }
      return
    }

    // 让预算、取消与供应商异常保留原错误类型，统一由任务边界处理。
    yield* executeTextProviderStream(providerConfig, messages as Message[], temperature)
  }
}
