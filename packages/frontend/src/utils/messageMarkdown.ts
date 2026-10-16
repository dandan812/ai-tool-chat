import { createSafeMarkdownRenderer, escapeHtml, escapeHtmlAttr } from './safeMarkdown'
import type { EvidenceSource } from '../types/task'
import { evidenceAllowlist } from './evidencePresentation'

const messageMarkdown = createSafeMarkdownRenderer((str: string, lang: string) => {
  const escapedStr = escapeHtml(str)
  const langDisplay = escapeHtml(lang || 'text')

  return `
<div class="code-block-wrapper">
  <div class="code-block-header">
    <span class="code-lang">${langDisplay}</span>
    <button class="copy-code-btn" data-code="${escapeHtmlAttr(str)}" title="复制代码">
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
      </svg>
      <span class="btn-text">复制</span>
    </button>
  </div>
  <pre><code class="language-${escapeHtmlAttr(lang || 'text')}">${escapedStr}</code></pre>
</div>
  `.trim()
})

interface EvidenceRenderEnvironment {
  evidence: Map<string, EvidenceSource>
  enableCitations: boolean
}

// Text tokens only: never transform a fenced/inline code example, HTML, or a link target.
messageMarkdown.renderer.rules.text = (
  tokens,
  index,
  _options,
  environment: EvidenceRenderEnvironment
) => {
  const text = tokens[index]?.content ?? ''
  if (!environment.enableCitations || !text.includes('[S:')) return escapeHtml(text)
  let linkDepth = 0
  for (let i = 0; i < index; i++) {
    if (tokens[i]?.type === 'link_open') linkDepth++
    else if (tokens[i]?.type === 'link_close') linkDepth--
  }
  if (linkDepth > 0) return escapeHtml(text)
  let cursor = 0
  let html = ''
  for (const match of text.matchAll(/\[S:([^\]\r\n]+)\]/g)) {
    html += escapeHtml(text.slice(cursor, match.index))
    const id = match[1] ?? ''
    const source = environment.evidence.get(id)
    if (source) {
      const number = [...environment.evidence.keys()].indexOf(id) + 1
      html += `<button type="button" class="evidence-citation" data-evidence-source="${escapeHtmlAttr(id)}" aria-label="查看原文来源 ${number}">来源 ${number}</button>`
    } else {
      html +=
        '<span class="evidence-invalid" title="此引用不在当前回答的来源列表中，无法核对">[无效引用]</span>'
    }
    cursor = (match.index ?? 0) + match[0].length
  }
  return html + escapeHtml(text.slice(cursor))
}

export function renderMessageMarkdown(
  content: string,
  sources: EvidenceSource[] = [],
  enableCitations = true
): string {
  // Fresh per-render environment: no global allowlist that could leak across messages/accounts.
  return messageMarkdown.render(content, { evidence: evidenceAllowlist(sources), enableCitations })
}

export function handleMessageMarkdownClick(
  event: MouseEvent,
  options: { sources?: EvidenceSource[]; onEvidence?: (sourceId: string) => void } = {}
): void {
  if (!(event.target instanceof Element)) return
  const target = event.target
  const container = event.currentTarget
  const citation = target.closest<HTMLButtonElement>('.evidence-citation')
  if (citation && container instanceof Element && container.contains(citation)) {
    const id = citation.dataset.evidenceSource ?? ''
    if (evidenceAllowlist(options.sources).has(id)) {
      event.preventDefault()
      options.onEvidence?.(id)
    }
    return
  }
  const button = target.closest('.copy-code-btn') as HTMLElement | null
  if (!button) return

  const code = button.getAttribute('data-code')
  if (!code) return

  if (!navigator.clipboard?.writeText) {
    button.setAttribute('title', '当前浏览器不支持自动复制，请手动选择代码')
    return
  }
  navigator.clipboard
    .writeText(code)
    .then(() => {
      const buttonText = button.querySelector('.btn-text')
      const originalText = buttonText?.textContent ?? '复制'

      if (buttonText) {
        buttonText.textContent = '已复制'
      }

      button.classList.add('copied')

      setTimeout(() => {
        if (buttonText) {
          buttonText.textContent = originalText
        }
        button.classList.remove('copied')
      }, 1800)
    })
    .catch(() => {
      button.setAttribute('title', '复制失败，请手动选择代码或允许剪贴板权限')
    })
}
