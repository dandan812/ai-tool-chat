import type { EvidenceSource, TaskMetrics } from '../types/task'

/** Validate metadata even after restoring it from local storage; never trust an ID as a URL. */
export function evidenceAllowlist(sources: EvidenceSource[] = []): Map<string, EvidenceSource> {
  const allowed = new Map<string, EvidenceSource>()
  for (const source of sources) {
    if (!source || typeof source.sourceId !== 'string' || !/^[A-Za-z0-9_-]{1,512}$/.test(source.sourceId)
      || typeof source.fileName !== 'string' || typeof source.fileId !== 'string'
      || typeof source.excerpt !== 'string' || source.excerpt.length > 8000
      || !Number.isInteger(source.startLine) || !Number.isInteger(source.endLine)
      || source.startLine < 1 || source.endLine < source.startLine) continue
    if (!allowed.has(source.sourceId)) allowed.set(source.sourceId, source)
  }
  return allowed
}

function nonnegative(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

export function presentTaskMetrics(metrics: TaskMetrics) {
  const count = (value: number | null) => nonnegative(value) ? Math.round(value).toLocaleString('zh-CN') : '未知'
  const tokenSource = metrics.tokenSource === 'provider' ? '供应商返回'
    : metrics.tokenSource === 'estimated' ? '估算' : '未知'
  const currency = typeof metrics.currency === 'string' && /^[A-Z]{3}$/.test(metrics.currency) ? metrics.currency : null
  return {
    elapsed: nonnegative(metrics.elapsedMs) ? `${(metrics.elapsedMs / 1000).toFixed(1)} 秒` : '未知',
    firstContent: nonnegative(metrics.firstContentMs) ? `${(metrics.firstContentMs / 1000).toFixed(1)} 秒` : '尚未记录',
    modelCalls: nonnegative(metrics.modelCalls) ? `${Math.floor(metrics.modelCalls)} 次` : '未知',
    tokens: `输入 ${count(metrics.inputTokens)} / 输出 ${count(metrics.outputTokens)}（${tokenSource}）`,
    cost: metrics.costSource === 'estimated' && nonnegative(metrics.estimatedCost) && currency
      ? `${metrics.estimatedCost.toFixed(6)} ${currency}（估算，非账单）`
      : '未知（未提供可用价格或用量，不能按 0 元理解）',
  }
}
