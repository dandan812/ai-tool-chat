import type { Skill, SkillContext, SkillInput, SkillStreamChunk } from '../types';
import { getUploadedFileContent } from '../upload/uploadedFileStorage';
import { resolveFileUserQuestion } from './fileSkillSupport';
import { answerFromFiles } from './fileAnswer';

export const fileSkill: Skill = {
  name: 'file-chat',
  type: 'text',
  description: '读取文本或代码资料，选择原文依据后回答',

  async *execute(input: SkillInput, context: SkillContext): AsyncIterable<SkillStreamChunk> {
    context.env.RUNTIME_CONTROL?.signal.throwIfAborted();
    yield { type: 'progress', progress: { message: '正在读取已上传资料...', current: 0, total: 1 } };
    const files = await Promise.all((input.files ?? []).map(file => getUploadedFileContent(context.env, file)));
    const question = resolveFileUserQuestion(input.messages);
    yield* answerFromFiles(files, question, input, context);
  },
};

export { isSupportedTextFile } from './fileSkillSupport';
