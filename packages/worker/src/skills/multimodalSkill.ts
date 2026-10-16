/**
 * 多模态 Skill - 使用部署配置的视觉理解模型
 *
 * Skill 层不关心 Base64 图片的兼容接口格式，不单独维护 fetch + SSE 读取逻辑。
 * 这些供应商细节全部下沉到 provider 层，Skill 只表达“这是一次图文对话”。
 */
import type { Skill, SkillContext, SkillInput, SkillStreamChunk } from '../types'
import {
  executeQwenMultimodalStream,
  resolveQwenMultimodalProviderConfig
} from '../providers/multimodalProvider'
import { getUploadedFileContent } from '../upload/uploadedFileStorage'
import { buildFileAnswerContext } from '../retrieval/fileContext'
import { chooseFileAnswerMode } from './fileAnswer'
import { resolveFileUserQuestion } from './fileSkillSupport'
import { EVIDENCE_INSTRUCTIONS, formatEvidenceSources } from '../retrieval/evidence'
import type { Message, ResolvedFileContent } from '../types'

export const multimodalSkill: Skill = {
  name: 'multimodal-chat',
  type: 'multimodal',
  description: '基于视觉模型的图文对话技能',

  async *execute(input: SkillInput, context: SkillContext): AsyncIterable<SkillStreamChunk> {
    const { messages, images = [], temperature = 0.7 } = input
    const providerConfig = resolveQwenMultimodalProviderConfig(input, context)

    if (!providerConfig) {
      yield { type: 'error', error: '图片模型尚未配置，请联系管理员。' }
      return
    }

    let groundedMessages = messages
    if (input.files?.length) {
      const files: ResolvedFileContent[] = []
      yield {
        type: 'progress',
        progress: { message: '正在检索图文对照所需的文件依据...', current: 0, total: 2 }
      }
      for (const file of input.files) {
        context.env.RUNTIME_CONTROL?.signal.throwIfAborted()
        files.push(await getUploadedFileContent(context.env, file))
      }
      const question = resolveFileUserQuestion(messages)
      const answer = await buildFileAnswerContext(
        files,
        question,
        context.env,
        chooseFileAnswerMode(files, question)
      )
      context.env.RUNTIME_CONTROL?.signal.throwIfAborted()
      yield { type: 'sources', sources: answer.sources }
      groundedMessages = [
        {
          role: 'system',
          content: `${EVIDENCE_INSTRUCTIONS}\n结合用户图片与文件回答。区分图片观察和文件事实，图片观察不能冒用文件引用。`
        },
        {
          role: 'user',
          content: `文件依据：\n${answer.emptyAnswer ?? formatEvidenceSources(answer.sources)}\n\n问题：${question}`
        }
      ] satisfies Message[]
    }
    yield* executeQwenMultimodalStream(providerConfig, groundedMessages, images, temperature)
  }
}
