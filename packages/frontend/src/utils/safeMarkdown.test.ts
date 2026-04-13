import { describe, expect, it } from 'vitest'
import { createSafeMarkdownRenderer, sanitizeLink } from './safeMarkdown'

function createRenderer() {
  return createSafeMarkdownRenderer((code, lang) => {
    return `<pre><code class="language-${lang || 'text'}">${code}</code></pre>`
  })
}

describe('safeMarkdown', () => {
  it('应该过滤原始 script 标签', () => {
    const renderer = createRenderer()
    const html = renderer.render('<script>alert(1)</script>**ok**')

    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('<strong>ok</strong>')
  })

  it('应该拦截 javascript 协议链接', () => {
    const renderer = createRenderer()
    const html = renderer.render('[恶意链接](javascript:alert(1))')

    expect(html).not.toContain('javascript:alert')
    expect(html).toContain('href="#"')
  })

  it('应该保留安全链接', () => {
    expect(sanitizeLink('https://example.com')).toBe('https://example.com')
    expect(sanitizeLink('/docs/test')).toBe('/docs/test')
    expect(sanitizeLink('mailto:test@example.com')).toBe('mailto:test@example.com')
  })
})
