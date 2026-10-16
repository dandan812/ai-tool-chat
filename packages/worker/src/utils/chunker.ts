import { isTextBoundary, nextTextBoundary } from './textBoundaries'

/** Compatibility heuristic, not a provider tokenizer: counts original UTF-16 units. */
export function estimateTokens(text: string): number {
  let ascii = 0
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) <= 0x7f) ascii++
  }
  return tokenCost(ascii, text.length - ascii)
}

function tokenCost(ascii: number, other: number): number {
  return Math.ceil(ascii / 4) + Math.ceil(other / 1.5)
}

export interface TokenTextRange {
  startOffset: number
  endOffset: number
  tokenCount: number
}

/**
 * Produces a contiguous, lossless partition under both limits. Natural breaks
 * are considered only inside the fitting prefix. No normalization or trimming.
 * An indivisible unit that cannot fit (e.g. emoji under budget 1) throws.
 */
export function splitTextRanges(
  text: string,
  maxTokens: number,
  maxChars: number = Number.MAX_SAFE_INTEGER
): TokenTextRange[] {
  for (const [name, value] of [
    ['maxTokens', maxTokens],
    ['maxChars', maxChars]
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 1)
      throw new RangeError(`${name} must be a positive safe integer`)
  }
  const ranges: TokenTextRange[] = []
  let start = 0
  while (start < text.length) {
    let end = start
    let ascii = 0
    let other = 0
    while (end < text.length) {
      const next = nextTextBoundary(text, end)
      const width = next - end
      const isAscii = text.charCodeAt(end) <= 0x7f
      const nextAscii = ascii + (isAscii ? width : 0)
      const nextOther = other + (isAscii ? 0 : width)
      if (next - start > maxChars || tokenCost(nextAscii, nextOther) > maxTokens) break
      ascii = nextAscii
      other = nextOther
      end = next
    }
    if (end === start)
      throw new RangeError(`Text unit at UTF-16 offset ${start} cannot fit the chunk limits`)
    const chosenEnd = end === text.length ? end : preferredBreak(text, start, end)
    ranges.push({
      startOffset: start,
      endOffset: chosenEnd,
      tokenCount:
        chosenEnd === end ? tokenCost(ascii, other) : estimateTokens(text.slice(start, chosenEnd))
    })
    start = chosenEnd
  }
  return ranges
}

export function splitByTokens(text: string, maxTokens: number): string[] {
  return splitTextRanges(text, maxTokens).map((range) =>
    text.slice(range.startOffset, range.endOffset)
  )
}

/** targetPosition is now a hard upper bound, not permission to look ahead. */
export function findSafeSplitPoint(text: string, targetPosition: number): number {
  if (!Number.isFinite(targetPosition)) throw new RangeError('targetPosition must be finite')
  let end = Math.min(text.length, Math.max(0, Math.floor(targetPosition)))
  while (!isTextBoundary(text, end)) end--
  return end === text.length ? end : preferredBreak(text, 0, end)
}

function preferredBreak(text: string, start: number, end: number): number {
  const searchStart = Math.max(start + 1, end - Math.min(200, Math.floor((end - start) / 2)))
  let best = end
  let bestRank = 0
  for (let offset = searchStart; offset <= end; offset++) {
    if (!isTextBoundary(text, offset)) continue
    const before = text[offset - 1]
    let rank = 0
    if (before === '\n' || before === '\r') {
      const previous = before === '\n' && text[offset - 2] === '\r' ? offset - 3 : offset - 2
      rank = text[previous] === '\n' || text[previous] === '\r' ? 5 : 4
    } else if (/[。.!！?？]/.test(before)) rank = 3
    else if (/[,，;；]/.test(before)) rank = 2
    else if (/\s/.test(before)) rank = 1
    if (rank > 0 && rank >= bestRank) {
      best = offset
      bestRank = rank
    }
  }
  return best
}

// ==================== 上下文保留 ====================

/**
 * 为分块添加上下文
 * 在每块前后保留少量上下文行，避免丢失关键信息
 *
 * @param chunks - 原始分块
 * @param contextLines - 保留的上下文行数
 * @returns 带上下文的分块
 */
export function addContextToChunks(chunks: string[], contextLines: number = 50): string[] {
  if (chunks.length <= 1) {
    return chunks
  }

  const result: string[] = []

  for (let i = 0; i < chunks.length; i++) {
    let chunk = chunks[i]

    // 为第一个块添加后置上下文
    if (i === 0 && chunks.length > 1) {
      const nextChunkLines = chunks[1].split('\n')
      const context = nextChunkLines.slice(0, contextLines).join('\n')
      chunk += '\n\n[后续上下文]\n' + context
    }

    // 为最后一个块添加前置上下文
    if (i === chunks.length - 1 && chunks.length > 1) {
      const prevChunkLines = chunks[chunks.length - 2].split('\n')
      const context = prevChunkLines.slice(-contextLines).join('\n')
      chunk = '[前置上下文]\n' + context + '\n\n' + chunk
    }

    // 为中间块添加前后上下文
    if (i > 0 && i < chunks.length - 1) {
      const prevChunkLines = chunks[i - 1].split('\n')
      const prevContext = prevChunkLines.slice(-contextLines).join('\n')

      const nextChunkLines = chunks[i + 1].split('\n')
      const nextContext = nextChunkLines.slice(0, contextLines).join('\n')

      chunk = '[前置上下文]\n' + prevContext + '\n\n' + chunk + '\n\n[后续上下文]\n' + nextContext
    }

    result.push(chunk)
  }

  return result
}
