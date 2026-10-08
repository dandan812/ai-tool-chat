import type { ResolvedFileContent, SkillContext, SkillInput, SkillStreamChunk } from '../types';
import { getUploadedFileContent } from '../upload/uploadedFileStorage';
import { answerFromFiles } from './fileAnswer';

// 旧接口兼容层。新的文件主链路直接调用 answerFromFiles，不再传入无效的全文参数。
export async function* processSmallFiles(
  _fileContents: string,
  userQuestion: string,
  input: SkillInput,
  context: SkillContext,
  resolvedFiles?: ResolvedFileContent[],
): AsyncIterable<SkillStreamChunk> {
  const files = resolvedFiles ?? await Promise.all(
    (input.files ?? []).map(file => getUploadedFileContent(context.env, file)));
  yield* answerFromFiles(files, userQuestion, input, context, 'direct');
}

export async function* processLargeFiles(
  files: ResolvedFileContent[],
  _fileContents: string,
  userQuestion: string,
  input: SkillInput,
  context: SkillContext,
): AsyncIterable<SkillStreamChunk> {
  yield* answerFromFiles(files, userQuestion, input, context, 'overview');
}

export async function* processTextFilesWithRetrieval(
  files: ResolvedFileContent[],
  userQuestion: string,
  input: SkillInput,
  context: SkillContext,
  _totalTokens: number,
  _allFileContents: string,
  forceOverviewMode = false,
): AsyncIterable<SkillStreamChunk> {
  yield* answerFromFiles(files, userQuestion, input, context, forceOverviewMode ? 'overview' : 'retrieval');
}
