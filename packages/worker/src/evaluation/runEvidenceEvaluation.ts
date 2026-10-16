import type { ResolvedFileContent } from '../types'
import {
  auditEvidenceReferences,
  limitEvidenceSources,
  MAX_EVIDENCE_TOTAL_CHARS
} from '../retrieval/evidence'
import {
  buildTextRetrievalIndex,
  retrieveRelevantText,
  retrieveOverviewText
} from '../retrieval/text/textRetriever'
import { EVIDENCE_FIXTURES, type EvidenceFixture } from './evidenceFixtures'

/** No network, model invocation, user documents, or credentials are involved. */
export function runEvidenceCase(fixture: EvidenceFixture) {
  const started = performance.now()
  const files: ResolvedFileContent[] = fixture.documents.map((content, i) => ({
    fileId: `${fixture.id}-document-${i}`,
    fileHash: `fixture-v1-${fixture.id}-${i}`,
    fileName: fixture.citationMode === 'duplicate-name' ? 'same.txt' : `document-${i}.txt`,
    content,
    size: content.length,
    mimeType: 'text/plain',
    source: 'uploaded'
  }))
  const indices = files.map((file) => buildTextRetrievalIndex(file, 400))
  const budget = fixture.kind === 'budget' ? 1 : 6000
  const retrieval =
    fixture.kind === 'overview' || fixture.kind === 'citation'
      ? retrieveOverviewText(indices, fixture.question, { topK: 6, maxPromptTokens: budget })
      : retrieveRelevantText(indices, fixture.question, {
          chunkSizeTokens: 400,
          topK: 6,
          maxPromptTokens: budget,
          minRelevance: 0.12
        })
  const sources = limitEvidenceSources(retrieval.selectedChunks.map((chunk) => chunk.evidence))
  const errors: string[] = []
  const require = (condition: boolean, error: string) => {
    if (!condition) errors.push(error)
  }
  for (const source of sources) {
    const file = files.find((candidate) => candidate.fileId === source.fileId)!
    require(file.content.slice(source.startOffset, source.endOffset) ===
      source.excerpt, 'Original excerpt mismatch')
    require(file.content.slice(0, source.startOffset).split('\n').length ===
      source.startLine, 'Start line mismatch')
    require(file.content.slice(0, source.endOffset - 1).split('\n').length ===
      source.endLine, 'End line mismatch')
    require(/^[A-Za-z0-9_-]+$/.test(source.sourceId), 'Unsafe identifier')
  }
  require(sources.reduce((sum, source) => sum + source.excerpt.length, 0) <=
    MAX_EVIDENCE_TOTAL_CHARS, 'Evidence budget exceeded')
  require(retrieval.selectedTokens <= budget, 'Retrieval budget exceeded')
  if (fixture.kind === 'absent')
    require(retrieval.insufficient, 'Unsupported query incorrectly treated as sufficient')
  if (fixture.kind === 'budget')
    require(sources.length === 0 && retrieval.budgetExceeded, 'Tiny budget not enforced')
  if (fixture.expectedText)
    require(sources.some((source) =>
      source.excerpt.includes(fixture.expectedText!)
    ), 'Expected text was not retrieved')
  if (fixture.expectedFiles)
    require(new Set(sources.map((source) => source.fileId)).size ===
      fixture.expectedFiles, 'Comparison/overview lost a source document')
  if (fixture.kind === 'citation') {
    const answer =
      fixture.citationMode === 'missing'
        ? 'A statement without evidence'
        : fixture.citationMode === 'forged'
          ? '[S:another-account] [S:javascript:alert(1)]'
          : sources.map((source) => `[S:${source.sourceId}]`).join(' ')
    const audit = auditEvidenceReferences(answer, sources)
    if (fixture.citationMode === 'missing')
      require(!audit.hasReferences, 'Missing citations not recognized')
    else if (fixture.citationMode === 'forged')
      require(audit.validIds.length === 0 &&
        audit.invalidIds.length === 2, 'Forged citations accepted')
    else
      require(audit.validIds.length === sources.length &&
        audit.invalidIds.length === 0 &&
        sources.length > 0, 'Allowlisted citation mismatch')
    if (fixture.citationMode === 'duplicate-name')
      require(new Set(sources.map((source) => source.sourceId)).size ===
        2, 'Same-name files share identity')
  }
  return {
    id: fixture.id,
    category: fixture.kind,
    question: fixture.question,
    passed: errors.length === 0,
    errors,
    elapsedMs: performance.now() - started,
    sourceCount: sources.length,
    selectedTokens: retrieval.selectedTokens,
    tokenSource: 'estimated' as const
  }
}

export function runEvidenceEvaluation() {
  const started = performance.now()
  const cases = EVIDENCE_FIXTURES.map(runEvidenceCase)
  return {
    suite: 'offline-evidence-v1',
    generatedAt: new Date().toISOString(),
    scope:
      'Offline retrieval, excerpt fidelity, source isolation and citation syntax only. No generated-answer correctness evaluation.',
    modelInvocations: 0,
    modelAnswerQuality: 'not_evaluated',
    providerTokens: null,
    actualModelCost: null,
    costSource: 'unknown',
    durationScope: 'local_retrieval_only',
    elapsedMs: performance.now() - started,
    total: cases.length,
    passed: cases.filter((test) => test.passed).length,
    cases
  }
}
