import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EvidenceSource } from '../types/task'
import { handleMessageMarkdownClick, renderMessageMarkdown } from './messageMarkdown'

const source: EvidenceSource = {
  sourceId: 's-file_hash-0-12', fileId: 'file-one', fileHash: 'hash-one',
  fileName: 'notes.txt', excerpt: 'original text', startLine: 1, endLine: 1, startOffset: 0, endOffset: 13,
}
function dom(content: string, sources: EvidenceSource[] = []) {
  const container = document.createElement('div')
  container.innerHTML = renderMessageMarkdown(content, sources)
  document.body.append(container)
  return container
}
afterEach(() => { document.body.innerHTML = ''; vi.useRealTimers() })

describe('message citation rendering', () => {
  it('renders allowed references as safe buttons while preserving normal Markdown', () => {
    const container = dom(`**Conclusion** [S:${source.sourceId}]\n\n- detail\n\n[link](https://example.com)`, [source])
    expect(container.querySelector('strong')?.textContent).toBe('Conclusion')
    const button = container.querySelector<HTMLButtonElement>('.evidence-citation')!
    expect(button.type).toBe('button')
    expect(button.dataset.evidenceSource).toBe(source.sourceId)
    expect(button.textContent).toBe('来源 1')
    expect(button.getAttribute('aria-label')).toBe('查看原文来源 1')
    expect(container.querySelector('li')?.textContent).toBe('detail')
    expect(container.querySelector('a')?.rel).toContain('noopener')
  })

  it('does not turn fenced/inline code examples or link labels into citation buttons', () => {
    const marker = `[S:${source.sourceId}]`
    const container = dom('`' + marker + '`\n\n```txt\n' + marker + '\n```\n\n[see ' + marker + '](https://example.com)', [source])
    expect(container.querySelectorAll('.evidence-citation')).toHaveLength(0)
    expect(container.querySelectorAll('code')).toHaveLength(2)
    expect(container.querySelector('.copy-code-btn')?.getAttribute('data-code')).toContain(marker)
    expect(container.querySelector('a')?.textContent).toContain(marker)
  })

  it('labels unknown and malformed identifiers invalid without links, scripts or HTML attributes', () => {
    const container = dom('[S:unknown] [S:x" onclick="alert(1)] [S:javascript:alert(1)] <script>alert(1)</script>', [source])
    expect(container.querySelectorAll('.evidence-citation')).toHaveLength(0)
    expect(container.querySelectorAll('.evidence-invalid').length).toBeGreaterThanOrEqual(2)
    expect(container.querySelector('script, [onclick], [onerror]')).toBeNull()
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull()
  })

  it('keeps allowlists local to each render, including after switching accounts/messages', () => {
    expect(dom(`[S:${source.sourceId}]`, [source]).querySelector('.evidence-citation')).not.toBeNull()
    expect(dom(`[S:${source.sourceId}]`).querySelector('.evidence-citation')).toBeNull()
    const other = { ...source, sourceId: 'other-message' }
    expect(dom(`[S:${source.sourceId}]`, [other]).querySelector('.evidence-citation')).toBeNull()
  })

  it('ignores malicious source IDs and never interpolates filenames/excerpts into HTML', () => {
    const malicious = { ...source, sourceId: 'x" onclick="bad', fileName: '<img src=x onerror=bad>', excerpt: '<script>bad</script>' }
    const container = dom(`[S:${malicious.sourceId}]`, [malicious])
    expect(container.querySelector('.evidence-citation, img, script, [onclick]')).toBeNull()
    const goodId = { ...malicious, sourceId: source.sourceId }
    const safe = dom(`[S:${source.sourceId}]`, [goodId])
    expect(safe.querySelector('.evidence-citation')).not.toBeNull()
    expect(safe.innerHTML).not.toContain('onerror')
  })

  it('escapes code-fence language metadata and preserves original copy payload', async () => {
    vi.useFakeTimers()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const code = 'const html = "<script>test</script>";\n'
    const container = dom('```x"onclick="bad\n' + code + '```')
    expect(container.querySelector('[onclick], script')).toBeNull()
    container.addEventListener('click', (event) => handleMessageMarkdownClick(event as MouseEvent))
    container.querySelector<HTMLButtonElement>('.copy-code-btn')?.click()
    await Promise.resolve()
    expect(writeText).toHaveBeenCalledWith(code)
    expect(container.querySelector('.btn-text')?.textContent).toBe('已复制')
    vi.runAllTimers()
  })

  it('only dispatches clicks for IDs allowed in the clicked message container', () => {
    const onEvidence = vi.fn()
    const container = dom(`[S:${source.sourceId}]`, [source])
    container.addEventListener('click', (event) => handleMessageMarkdownClick(event as MouseEvent, { sources: [source], onEvidence }))
    container.querySelector<HTMLButtonElement>('.evidence-citation')?.click()
    expect(onEvidence).toHaveBeenCalledExactlyOnceWith(source.sourceId)
    const forged = document.createElement('button')
    forged.className = 'evidence-citation'
    forged.dataset.evidenceSource = 'cross-account'
    container.append(forged)
    forged.click()
    expect(onEvidence).toHaveBeenCalledTimes(1)
    const wrongContainer = dom(`[S:${source.sourceId}]`, [source])
    wrongContainer.addEventListener('click', (event) => handleMessageMarkdownClick(event as MouseEvent, { sources: [], onEvidence }))
    wrongContainer.querySelector<HTMLButtonElement>('.evidence-citation')?.click()
    expect(onEvidence).toHaveBeenCalledTimes(1)
  })
})
