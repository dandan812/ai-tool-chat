import MarkdownIt from 'markdown-it'
import type Token from 'markdown-it'

/**
 * Markdown 处理工具 - 优化版
 * 支持代码高亮、缓存、自定义渲染
 */

// MarkdownIt 实例缓存
let mdInstance: MarkdownIt | null = null

// 渲染结果缓存
const renderCache = new Map<string, string>()
const MAX_CACHE_SIZE = 100

/**
 * 获取 MarkdownIt 实例（单例模式）
 */
export function getMarkdownRenderer(): MarkdownIt {
  if (mdInstance) return mdInstance

  mdInstance = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: true,
    breaks: true,
    highlight: (str, lang) => {
      // 简单的代码高亮包装
      const langClass = lang ? `language-${lang}` : ''
      return `<pre class="code-block-wrapper"><div class="code-block-header"><span class="code-lang">${lang || 'text'}</span><button class="copy-code-btn" data-code="${escapeHtml(str)}">复制</button></div><code class="${langClass}">${escapeHtml(str)}</code></pre>`
    }
  })

  // 自定义代码块渲染
  const defaultRender = mdInstance.renderer.rules.fence || function(tokens: Token[], idx: number, options: object, env: object, self: any) {
    return self.renderToken(tokens, idx, options)
  }

  mdInstance.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx]
    if (!token) return ''
    const code = token.content
    const lang = token.info?.trim() || ''

    return `
      <div class="code-block-wrapper">
        <div class="code-block-header">
          <span class="code-lang">${lang || 'plaintext'}</span>
          <button class="copy-code-btn" data-code="${escapeHtml(code)}">复制</button>
        </div>
        <pre><code class="language-${lang || 'plaintext'}">${escapeHtml(code)}</code></pre>
      </div>
    `
  }

  // 自定义链接渲染（添加安全属性）
  const defaultLinkRender = mdInstance.renderer.rules.link_open || function(tokens, idx, options, env, self) {
    return self.renderToken(tokens, idx, options)
  }

  mdInstance.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    if (!tokens[idx]) return ''
    tokens[idx].attrSet('target', '_blank')
    tokens[idx].attrSet('rel', 'noopener noreferrer')
    return defaultLinkRender(tokens, idx, options, env, self)
  }

  return mdInstance
}

/**
 * HTML 转义
 */
function escapeHtml(text: string): string {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

/**
 * 渲染 Markdown（带缓存）
 */
export function renderMarkdown(content: string): string {
  if (!content) return ''

  // 检查缓存
  const cached = renderCache.get(content)
  if (cached !== undefined) {
    return cached
  }

  const md = getMarkdownRenderer()
  const result = md.render(content)

  // 存入缓存
  if (renderCache.size >= MAX_CACHE_SIZE) {
    const firstKey = renderCache.keys().next().value
    if (firstKey !== undefined) {
      renderCache.delete(firstKey)
    }
  }
  renderCache.set(content, result)

  return result
}

/**
 * 渲染 Markdown（同步，无缓存）
 */
export function renderMarkdownSync(content: string): string {
  if (!content) return ''
  const md = getMarkdownRenderer()
  return md.render(content)
}

/**
 * 提取纯文本
 */
export function extractText(content: string): string {
  const md = getMarkdownRenderer()
  const html = md.render(content)
  
  // 使用 DOM 提取文本
  const div = document.createElement('div')
  div.innerHTML = html
  return div.textContent || div.innerText || ''
}

/**
 * 截断文本
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength) + '...'
}

/**
 * 清空缓存
 */
export function clearMarkdownCache(): void {
  renderCache.clear()
}

/**
 * 获取缓存大小
 */
export function getCacheSize(): number {
  return renderCache.size
}
