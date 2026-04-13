import MarkdownIt from 'markdown-it'
import { LRUCache } from './lru'
import { createSafeMarkdownRenderer, escapeHtml } from './safeMarkdown'

/**
 * Markdown 处理工具 - 优化版
 * 支持代码高亮、缓存、自定义渲染
 */

// MarkdownIt 实例缓存
let mdInstance: MarkdownIt | null = null

// 渲染结果缓存
const renderCache = new LRUCache<string, string>(100)

/**
 * 获取 MarkdownIt 实例（单例模式）
 */
export function getMarkdownRenderer(): MarkdownIt {
  if (mdInstance) return mdInstance

  mdInstance = createSafeMarkdownRenderer((str, lang) => {
    const langClass = lang ? `language-${lang}` : ''
    return `<pre class="code-block-wrapper"><div class="code-block-header"><span class="code-lang">${lang || 'text'}</span><button class="copy-code-btn" data-code="${escapeHtml(str)}">复制</button></div><code class="${langClass}">${escapeHtml(str)}</code></pre>`
  })

  return mdInstance
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
