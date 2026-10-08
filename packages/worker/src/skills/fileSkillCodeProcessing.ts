import type { ResolvedFileContent, SkillContext, SkillInput, SkillStreamChunk } from '../types';
import { shouldPreferGlobalSummary } from './fileSkillSupport';
import { answerFromFiles } from './fileAnswer';

/** Use the parser only to select original line ranges, never its synthetic summary as evidence. */
export async function* processCodeFilesWithRAG(
  files: ResolvedFileContent[], userQuestion: string, input: SkillInput, context: SkillContext,
): AsyncIterable<SkillStreamChunk> {
  yield* answerFromFiles(files, userQuestion, input, context, 'code');
}

/** Mixed files now share bounded original-text retrieval instead of citing lossy code compression. */
export async function* processMixedFiles(
  files: ResolvedFileContent[], userQuestion: string, input: SkillInput, context: SkillContext,
): AsyncIterable<SkillStreamChunk> {
  yield* answerFromFiles(files, userQuestion, input, context,
    shouldPreferGlobalSummary(userQuestion) ? 'overview' : 'retrieval');
}
