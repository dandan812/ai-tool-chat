import { describe, expect, it } from 'vitest'
import type { EvidenceSource, TaskMetrics } from '../types/task'
import { evidenceAllowlist, presentTaskMetrics } from './evidencePresentation'

const source: EvidenceSource = { sourceId: 'source_1', fileId: 'file-1', fileHash: 'hash', fileName: 'notes', excerpt: 'hello', startLine: 1, endLine: 1, startOffset: 0, endOffset: 5 }
const metrics: TaskMetrics = { elapsedMs: 2500, firstContentMs: 800, modelCalls: 1, inputTokens: null, outputTokens: null, tokenSource: 'unknown', estimatedCost: null, currency: null, costSource: 'unknown' }

describe('evidence and metrics presentation', () => {
  it('accepts only bounded valid source metadata, preserving first stable ID', () => {
    const sources = [source, { ...source, excerpt: 'duplicate' }, { ...source, sourceId: 'evil"' }, { ...source, sourceId: 'long', excerpt: 'x'.repeat(8001) }, { ...source, sourceId: 'invalid-line', startLine: 0 }]
    expect([...evidenceAllowlist(sources).values()]).toEqual([source])
  })
  it('does not turn missing usage or pricing into a zero-cost assertion', () => {
    const view = presentTaskMetrics(metrics)
    expect(view.tokens).toBe('输入 未知 / 输出 未知（未知）')
    expect(view.cost).toContain('未知')
    expect(view.cost).toContain('不能按 0 元理解')
    expect(view.elapsed).toBe('2.5 秒')
  })
  it('labels estimates as estimates, not a real invoice, and provider tokens separately', () => {
    const view = presentTaskMetrics({ ...metrics, inputTokens: 200, outputTokens: 100, tokenSource: 'estimated', estimatedCost: .0004, currency: 'USD', costSource: 'estimated' })
    expect(view.tokens).toContain('估算')
    expect(view.cost).toBe('0.000400 USD（估算，非账单）')
    expect(presentTaskMetrics({ ...metrics, inputTokens: 100, outputTokens: 20, tokenSource: 'provider' }).tokens).toContain('供应商返回')
  })
  it('rejects invalid numeric values and malformed currencies instead of displaying NaN or false precision', () => {
    const view = presentTaskMetrics({ ...metrics, elapsedMs: NaN, firstContentMs: -1, modelCalls: Infinity, inputTokens: -2, estimatedCost: 1, currency: '<img>', costSource: 'estimated' })
    expect(view.elapsed).toBe('未知')
    expect(view.firstContent).toBe('尚未记录')
    expect(view.modelCalls).toBe('未知')
    expect(view.cost).toContain('未知')
  })
})
