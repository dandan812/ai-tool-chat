import type { ResolvedFileContent, SkillContext, SkillInput, SkillStreamChunk } from '../types';
import { buildFileAnswerContext, type FileAnswerMode } from '../retrieval/fileContext';
import { isCodeFile, selectFileTextExecutor, shouldPreferDirectFileAnswer, shouldPreferGlobalSummary } from './fileSkillSupport';
import { estimateTokens } from '../utils/chunker';

export function chooseFileAnswerMode(files: ResolvedFileContent[], question: string): FileAnswerMode {
  if (files.length && files.every(file => isCodeFile(file.fileName))) return 'code';
  const overview = shouldPreferGlobalSummary(question);
  if (files.some(file => isCodeFile(file.fileName))) return overview ? 'overview' : 'retrieval';
  const totalTokens = files.reduce((sum, file) => sum + estimateTokens(file.content), 0);
  if (shouldPreferDirectFileAnswer(totalTokens, files.length)) return 'direct';
  return overview ? 'overview' : 'retrieval';
}

/** 原文先于答案发送；依据不足时结束，不发起付费概览调用。 */
export async function* answerFromFiles(
  files: ResolvedFileContent[], question: string, input: SkillInput, context: SkillContext,
  mode = chooseFileAnswerMode(files, question),
): AsyncIterable<SkillStreamChunk> {
  context.env.RUNTIME_CONTROL?.signal.throwIfAborted();
  yield { type: 'progress', progress: { message: '正在选择可核对的原文片段...', current: 0, total: 2 } };
  const answer = await buildFileAnswerContext(files, question, context.env, mode);
  context.env.RUNTIME_CONTROL?.signal.throwIfAborted();
  yield { type: 'sources', sources: answer.sources };
  if (answer.emptyAnswer) {
    yield { type: 'content', content: answer.emptyAnswer };
    yield { type: 'complete' };
    return;
  }
  yield {
    type: 'progress',
    progress: {
      message: answer.mode === 'overview' ? '基于代表性原文片段生成概览（非全文）...'
        : `基于 ${answer.sources.length} 个可核对片段生成回答...`,
      current: 1, total: 2,
    },
  };
  const executor = selectFileTextExecutor(input, context);
  yield* executor.execute({ ...input, messages: answer.messages, model: executor.model }, context);
}
