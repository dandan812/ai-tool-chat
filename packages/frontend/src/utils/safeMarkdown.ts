import MarkdownIt from 'markdown-it'

const UNSAFE_PROTOCOL_PATTERN = /^(vbscript|javascript|data):/i

type FenceRenderer = NonNullable<MarkdownIt['renderer']['rules']['fence']>
type LinkOpenRenderer = NonNullable<MarkdownIt['renderer']['rules']['link_open']>

/**
 * 统一转义 HTML 文本，避免代码块和按钮属性把原始字符串重新带回 DOM。
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

/**
 * 属性值转义和 HTML 文本转义的规则略有不同：
 * 这里额外处理换行，避免写回 data-* 属性时破坏结构。
 */
export function escapeHtmlAttr(text: string): string {
  return escapeHtml(text)
    .replace(/\n/g, '&#10;')
    .replace(/\r/g, '&#13;')
}

/**
 * 只允许 http(s)、mailto、tel 以及站内相对链接。
 * 其他协议统一降级为 `#`，避免 `javascript:` / `data:` 注入。
 */
export function sanitizeLink(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) {
    return '#'
  }

  if (
    trimmed.startsWith('/') ||
    trimmed.startsWith('./') ||
    trimmed.startsWith('../') ||
    trimmed.startsWith('#')
  ) {
    return trimmed
  }

  if (UNSAFE_PROTOCOL_PATTERN.test(trimmed)) {
    return '#'
  }

  try {
    const parsed = new URL(trimmed, 'https://safe.local')
    if (['http:', 'https:', 'mailto:', 'tel:'].includes(parsed.protocol)) {
      return trimmed
    }
  } catch {
    return '#'
  }

  return '#'
}

/**
 * 创建统一的安全 Markdown 渲染器。
 * 关键策略：
 * - 禁止原始 HTML 直通
 * - 代码块和属性值全部自行转义
 * - 链接只保留安全协议
 */
export function createSafeMarkdownRenderer(
  highlight: (code: string, lang: string) => string,
): MarkdownIt {
  const renderer = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: true,
    breaks: true,
    highlight: (str, lang) => highlight(str, lang || ''),
  })

  renderer.validateLink = () => true
  renderer.normalizeLink = (url) => sanitizeLink(url)

  renderer.renderer.rules.fence = ((tokens, idx) => {
    const token = tokens[idx]
    if (!token) return ''
    return highlight(token.content, token.info?.trim() || '')
  }) as FenceRenderer

  const defaultLinkRender: LinkOpenRenderer =
    renderer.renderer.rules.link_open ||
    ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))

  renderer.renderer.rules.link_open = ((tokens, idx, options, env, self) => {
    const token = tokens[idx]
    if (!token) return ''

    const href = token.attrGet('href') || ''
    token.attrSet('href', sanitizeLink(href))
    token.attrSet('target', '_blank')
    token.attrSet('rel', 'noopener noreferrer nofollow')
    return defaultLinkRender(tokens, idx, options, env, self)
  }) as LinkOpenRenderer

  return renderer
}
