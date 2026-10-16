import type {
  ResolvedFileContent,
  Skill,
  SkillContext,
  SkillInput,
  SkillStreamChunk
} from '../types'
import { getUploadedFileContent } from '../upload/uploadedFileStorage'
import { resolveFileUserQuestion } from './fileSkillSupport'
import { answerFromFiles } from './fileAnswer'

export const fileSkill: Skill = {
  name: 'file-chat',
  type: 'text',
  description: '解析文档、表格、文本或代码资料，选择原文依据后回答',

  async *execute(input: SkillInput, context: SkillContext): AsyncIterable<SkillStreamChunk> {
    context.env.RUNTIME_CONTROL?.signal.throwIfAborted()
    yield {
      type: 'progress',
      progress: { message: '正在读取并解析已上传资料...', current: 0, total: 1 }
    }
    const files: ResolvedFileContent[] = []
    // Parsing is serialized globally; stop this batch before queuing more work on failure.
    for (const file of input.files ?? []) {
      files.push(await getUploadedFileContent(context.env, file))
    }
    const question = resolveFileUserQuestion(input.messages)
    yield* answerFromFiles(files, question, input, context)
  }
}
