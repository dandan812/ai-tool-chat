import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EvidenceSource, ResolvedFileContent, SkillContext, SkillInput, SkillStreamChunk } from '../types';
import { createMockEnv } from '../test/mocks';
import { processSmallFiles, processLargeFiles, processTextFilesWithRetrieval } from './fileSkillTextProcessing';
import { processCodeFilesWithRAG, processMixedFiles } from './fileSkillCodeProcessing';
import { MAX_EVIDENCE_TOTAL_CHARS } from '../retrieval/evidence';

const observed = vi.hoisted(() => ({ inputs: [] as SkillInput[] }));
vi.mock('./textSkill', () => ({ textSkill: {
  name: 'offline-test-text', type: 'text',
  async *execute(input: SkillInput): AsyncIterable<SkillStreamChunk> {
    observed.inputs.push(input);
    yield { type: 'usage', usage: { callId: 'offline-stub', model: 'stub', tokenSource: 'unknown', outcome: 'completed' } };
    yield { type: 'content', content: 'Offline test stub, not a real model answer.' };
    yield { type: 'complete' };
  },
} }));

function file(content: string, name = 'notes.txt', id = 'file-one'): ResolvedFileContent {
  return { fileId: id, fileName: name, fileHash: `hash-${id}`, mimeType: 'text/plain', source: 'uploaded', content, size: content.length };
}

async function collect(stream: AsyncIterable<SkillStreamChunk>) {
  const chunks: SkillStreamChunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

function originalLineAt(content: string, offset: number): number {
  return 1 + [...content.matchAll(/\r\n|\r|\n/g)]
    .filter(match => match.index! + match[0].length <= offset).length;
}

function verifySources(chunks: SkillStreamChunk[], files: ResolvedFileContent[]) {
  const eventIndex = chunks.findIndex((chunk) => chunk.type === 'sources');
  const contentIndex = chunks.findIndex((chunk) => chunk.type === 'content');
  expect(eventIndex).toBeGreaterThanOrEqual(0);
  expect(eventIndex).toBeLessThan(contentIndex);
  const sources = chunks[eventIndex].sources as EvidenceSource[];
  expect(sources.length).toBeGreaterThan(0);
  expect(sources.reduce((sum, source) => sum + source.excerpt.length, 0)).toBeLessThanOrEqual(MAX_EVIDENCE_TOTAL_CHARS);
  for (const source of sources) {
    const original = files.find((candidate) => candidate.fileId === source.fileId)!;
    expect(source.excerpt).toBe(original.content.slice(source.startOffset, source.endOffset));
    expect(source.startLine).toBe(originalLineAt(original.content, source.startOffset));
    expect(source.endLine).toBe(originalLineAt(original.content, source.endOffset - 1));
    const prompt = observed.inputs.at(-1)!.messages.map((message) => message.content).join('\n');
    expect(prompt).toContain(`[S:${source.sourceId}]`);
    expect(prompt).toContain(JSON.stringify(source.excerpt));
  }
  expect(chunks.some((chunk) => chunk.type === 'usage')).toBe(true);
  expect(observed.inputs.at(-1)?.messages.find((message) => message.role === 'system')?.content)
    .toContain('没有找到足够依据');
  return sources;
}

describe('file evidence is wired before every answer path, offline only', () => {
  beforeEach(() => { observed.inputs.length = 0; });
  const input: SkillInput = { messages: [{ role: 'user', content: 'deployment region' }] };
  const context = () => ({ taskId: 'local-test', stepId: 'skill', env: createMockEnv(), mcpClient: {} } as SkillContext);

  it('direct small files include exact originals and do not add paid calls', async () => {
    const files = [file('deployment region: Tokyo.\r\nKeep original spacing.\n')];
    verifySources(await collect(processSmallFiles('', 'deployment region', input, context(), files)), files);
    expect(observed.inputs.length).toBe(1);
  });

  it('does not turn whitespace-only files into paid direct answers after lossless chunking', async () => {
    const files = [file(' \t\r\n \r\n')];
    const chunks = await collect(processSmallFiles('', 'question', input, context(), files));
    expect(observed.inputs).toHaveLength(0);
    expect(chunks.find(chunk => chunk.type === 'sources')?.sources).toEqual([]);
    expect(chunks.find(chunk => chunk.type === 'content')?.content).toContain('没有可分析的文本');
  });

  it('retrieval includes only supplied source markers', async () => {
    const files = [file('deployment region: Tokyo.\n'.repeat(150))];
    verifySources(await collect(processTextFilesWithRetrieval(files, 'deployment region', input, context(), 0, '')), files);
  });

  it('overview explicitly retains sampled rather than full-file semantics', async () => {
    const files = [file('opening\n'.repeat(1600) + '\nclosing')];
    verifySources(await collect(processTextFilesWithRetrieval(files, '概览', input, context(), 0, '', true)), files);
    expect(observed.inputs[0].messages[0].content).toContain('代表性片段');
  });

  it('legacy large-summary entry no longer launches unbounded map/reduce or cites model summaries', async () => {
    const files = [file('真实原文。\n'.repeat(11000))];
    verifySources(await collect(processLargeFiles(files, 'THIS IS A LOSSY SYNTHETIC SUMMARY', '概览', input, context())), files);
    expect(observed.inputs.length).toBe(1);
    expect(JSON.stringify(observed.inputs[0])).not.toContain('LOSSY SYNTHETIC SUMMARY');
  });

  it('code RAG converts actual line ranges without fabricated wrappers', async () => {
    const files = [file('const header = 1;\r\nfunction deploymentRegion() {\r\n  return "Tokyo";\r\n}\r\n', 'main.ts')];
    verifySources(await collect(processCodeFilesWithRAG(files, 'deploymentRegion', input, context())), files);
  });

  it('aligns parser line ranges with original evidence for standalone CR files', async () => {
    const lines = [
      ...Array.from({ length: 60 }, (_, i) => `// preceding line ${i}`),
      'function renewalLease() {', '  return "ok";', '}',
      ...Array.from({ length: 60 }, (_, i) => `// following line ${i}`),
    ];
    const files = [file(lines.join('\r'), 'main.ts')];
    const sources = verifySources(await collect(processCodeFilesWithRAG(files, 'renewalLease', input, context())), files);
    expect(sources.some(source => source.excerpt.includes('function renewalLease()'))).toBe(true);
  });

  it('code fallback separates head and tail instead of claiming a synthetic full range', async () => {
    const files = [file(Array.from({ length: 160 }, (_, i) => `line ${i}`).join('\r\n'), 'main.ts')];
    const sources = verifySources(await collect(processCodeFilesWithRAG(files, 'unfindableIdentifier', input, context())), files);
    expect(sources.length).toBe(2);
    expect(sources[0].endLine).toBeLessThan(sources[1].startLine);
  });

  it('mixed documents use original text, never compressed signatures as source evidence', async () => {
    const files = [file('deployment region: Tokyo.'), file('// deployment region: Osaka.\nconst value = 2;', 'main.ts', 'file-two')];
    const sources = verifySources(await collect(processMixedFiles(files, 'deployment region', input, context())), files);
    expect(new Set(sources.map((source) => source.fileId)).size).toBe(2);
  });

  it('unsupported factual query does not silently trigger a paid generic summary', async () => {
    const files = [file('A grocery shopping list with bread and eggs.')];
    const chunks = await collect(processTextFilesWithRetrieval(files, 'quantum entanglement threshold', input, context(), 0, ''));
    expect(observed.inputs.length).toBe(0);
    expect(chunks.find((chunk) => chunk.type === 'sources')?.sources).toEqual([]);
    expect(chunks.find((chunk) => chunk.type === 'content')?.content).toContain('没有检索到足够相关');
  });
});
