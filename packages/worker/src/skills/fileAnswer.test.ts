import { describe, expect, it, vi } from 'vitest';
import type { ResolvedFileContent, SkillContext, SkillStreamChunk } from '../types';
import { createMockEnv } from '../test/mocks';
const calls = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('./textSkill', () => ({
  textSkill: {
    async *execute(): AsyncIterable<SkillStreamChunk> {
      calls.execute();
      yield { type: 'content', content: 'offline answer' };
      yield { type: 'complete' };
    },
  },
}));
import { answerFromFiles, chooseFileAnswerMode } from './fileAnswer';
const file = (content: string, fileName = 'notes.txt'): ResolvedFileContent => ({
  fileId: fileName, fileName, fileHash: 'fixed-hash', source: 'uploaded',
  mimeType: 'text/plain', content, size: content.length,
});
const context = () => ({
  taskId: 'test', stepId: 'skill', env: createMockEnv(), mcpClient: {},
}) as SkillContext;

describe('file answer workflow', () => {
  it('selects code, mixed, direct and large retrieval modes explicitly', () => {
    expect(chooseFileAnswerMode([file('const value = 1', 'main.ts')], 'value')).toBe('code');
    expect(chooseFileAnswerMode([file('notes'), file('code', 'main.ts')], 'value')).toBe('retrieval');
    expect(chooseFileAnswerMode([file('notes')], 'notes')).toBe('direct');
    expect(chooseFileAnswerMode([file('真实原文'.repeat(15000))], '时间')).toBe('retrieval');
    expect(chooseFileAnswerMode([file('真实原文'.repeat(15000))], '全文概览')).toBe('overview');
  });
  it('publishes verifiable original sources before generated output', async () => {
    calls.execute.mockClear();
    const original = file('deployment region: Tokyo.\r\n');
    const chunks = [];
    for await (const chunk of answerFromFiles([original], 'deployment region', {
      messages: [{ role: 'user', content: 'deployment region' }],
    }, context())) chunks.push(chunk);
    const sources = chunks.find(chunk => chunk.type === 'sources')!.sources!;
    for (const source of sources) {
      expect(source.excerpt).toBe(original.content.slice(source.startOffset, source.endOffset));
    }
    expect(chunks.findIndex(chunk => chunk.type === 'sources')).toBeLessThan(chunks.findIndex(chunk => chunk.type === 'content'));
    expect(calls.execute).toHaveBeenCalledTimes(1);
  });
  it('does not generate a generic answer for a factual question without evidence', async () => {
    calls.execute.mockClear();
    const chunks = [];
    for await (const chunk of answerFromFiles([file('bread and eggs')], 'quantum threshold', {
      messages: [{ role: 'user', content: 'quantum threshold' }],
    }, context(), 'retrieval')) chunks.push(chunk);
    expect(calls.execute).not.toHaveBeenCalled();
    expect(chunks.find(chunk => chunk.type === 'sources')?.sources).toEqual([]);
    expect(chunks.at(-1)?.type).toBe('complete');
  });
});
