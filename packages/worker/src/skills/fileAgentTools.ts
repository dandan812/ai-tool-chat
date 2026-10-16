import type { EvidenceSource, ResolvedFileContent, ToolCall } from '../types'
import {
  createEvidenceSource,
  formatEvidenceSources,
  getOriginalLineStarts
} from '../retrieval/evidence'
import { buildTextRetrievalIndex, retrieveRelevantText } from '../retrieval/text/textRetriever'
import { findSafeSplitPoint } from '../utils/chunker'
import { isTextBoundary } from '../utils/textBoundaries'

export const FILE_AGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_files',
      description: 'Search the attached files for evidence. Use fileId to focus on one file.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', maxLength: 300 },
          fileId: { type: 'string', description: 'Optional catalog ID, e.g. f1' }
        },
        required: ['query'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description:
        'Read an original passage at a text line. For continuation pass nextOffset as startOffset with the same startLine.',
      parameters: {
        type: 'object',
        properties: {
          fileId: { type: 'string' },
          startLine: { type: 'integer', minimum: 1 },
          startOffset: { type: 'integer', minimum: 0 }
        },
        required: ['fileId', 'startLine'],
        additionalProperties: false
      }
    }
  }
]

const bytes = (value: string) => new TextEncoder().encode(value).length

/** Only server-resolved attachments enter this capability; no paths, URLs or storage keys are accepted. */
export function createFileAgentTools(files: ResolvedFileContent[]) {
  const catalog = files.map((file, i) => ({
    fileId: `f${i + 1}`,
    name: file.fileName,
    lines: getOriginalLineStarts(file).length
  }))
  const evidence = new Map<string, EvidenceSource>()
  const indices = files.map((file) => buildTextRetrievalIndex(file, 240))
  let evidenceBytes = 0

  function excerpt(
    file: ResolvedFileContent,
    start: number,
    proposedEnd: number
  ): EvidenceSource | undefined {
    let length = findSafeSplitPoint(
      file.content.slice(start, proposedEnd),
      Math.min(420, proposedEnd - start)
    )
    while (length > 0 && bytes(file.content.slice(start, start + length)) > 700) {
      length = findSafeSplitPoint(file.content.slice(start, proposedEnd), length - 1)
    }
    if (!length) return undefined
    const source = createEvidenceSource(file, start, start + length)
    const size = bytes(formatEvidenceSources([source]))
    if (!evidence.has(source.sourceId)) {
      if (evidenceBytes + size > 4000) return undefined
      evidence.set(source.sourceId, source)
      evidenceBytes += size
    }
    return source
  }

  function execute(call: ToolCall): {
    content: string
    sources: EvidenceSource[]
    isError?: boolean
  } {
    const args = call.arguments
    const fail = (error: string) => ({
      content: JSON.stringify({ error }),
      sources: [],
      isError: true
    })
    const index = catalog.findIndex((entry) => entry.fileId === args.fileId)
    if (call.name === 'search_files') {
      if (
        Object.keys(args).some((key) => !['query', 'fileId'].includes(key)) ||
        typeof args.query !== 'string' ||
        !args.query.trim() ||
        args.query.length > 300 ||
        (args.fileId !== undefined && index < 0)
      )
        return fail('Invalid query or attachment ID')
      const result = retrieveRelevantText(index < 0 ? indices : [indices[index]], args.query, {
        chunkSizeTokens: 240,
        topK: 2,
        maxPromptTokens: 480,
        minRelevance: 0.12
      })
      const matches = result.insufficient ? [] : result.selectedChunks
      const sources = matches.flatMap((chunk) => {
        const file = files.find((item) => item.fileId === chunk.fileId)!
        const hits = result.extractedKeywords
          .map((keyword) => chunk.content.toLowerCase().indexOf(keyword.toLowerCase()))
          .filter((offset) => offset >= 0)
        let start =
          chunk.evidence.startOffset + (hits.length ? Math.max(0, Math.min(...hits) - 60) : 0)
        while (start > chunk.evidence.startOffset && !isTextBoundary(file.content, start)) start--
        const source = excerpt(file, start, chunk.evidence.endOffset)
        return source ? [source] : []
      })
      return {
        sources,
        content: JSON.stringify({
          matches: sources.map((source) => ({
            fileId: catalog[files.findIndex((file) => file.fileId === source.fileId)].fileId,
            startLine: source.startLine,
            endLine: source.endLine,
            citation: `[S:${source.sourceId}]`,
            text: source.excerpt
          })),
          status: sources.length
            ? 'partial_evidence'
            : evidenceBytes >= 3000
              ? 'evidence_budget_reached'
              : 'no_evidence'
        })
      }
    }
    if (call.name === 'read_file') {
      if (
        Object.keys(args).some((key) => !['fileId', 'startLine', 'startOffset'].includes(key)) ||
        index < 0 ||
        !Number.isSafeInteger(args.startLine) ||
        Number(args.startLine) < 1 ||
        Number(args.startLine) > catalog[index].lines
      )
        return fail('Invalid attachment ID or text line')
      const file = files[index]
      const start =
        args.startOffset === undefined
          ? getOriginalLineStarts(file)[Number(args.startLine) - 1]
          : Number(args.startOffset)
      if (
        (args.startOffset !== undefined && typeof args.startOffset !== 'number') ||
        !Number.isSafeInteger(start) ||
        start < 0 ||
        start >= file.content.length ||
        !isTextBoundary(file.content, start)
      )
        return fail('Invalid text offset')
      const source = excerpt(file, start, file.content.length)
      return {
        sources: source ? [source] : [],
        content: JSON.stringify(
          source
            ? {
                fileId: args.fileId,
                citation: `[S:${source.sourceId}]`,
                text: source.excerpt,
                startLine: source.startLine,
                endLine: source.endLine,
                nextOffset: source.endOffset < file.content.length ? source.endOffset : null,
                partial: true
              }
            : { status: 'empty_or_evidence_budget_reached' }
        )
      }
    }
    return fail('Tool is not allowed')
  }

  return { catalog, execute, sources: () => [...evidence.values()] }
}
