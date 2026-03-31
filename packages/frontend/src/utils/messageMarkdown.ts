import MarkdownIt from 'markdown-it'

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function escapeAttr(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/\n/g, '&#10;')
    .replace(/\r/g, '&#13;')
}

const messageMarkdown = new MarkdownIt({
  highlight: (str: string, lang: string) => {
    const escapedStr = escapeHtml(str)
    const langDisplay = lang || 'text'

    return `
<div class="code-block-wrapper">
  <div class="code-block-header">
    <span class="code-lang">${langDisplay}</span>
    <button class="copy-code-btn" data-code="${escapeAttr(str)}" title="复制代码">
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
      </svg>
      <span class="btn-text">复制</span>
    </button>
  </div>
  <pre><code class="language-${lang || 'text'}">${escapedStr}</code></pre>
</div>
    `.trim()
  },
})

messageMarkdown.renderer.rules.fence = (tokens, idx) => {
  const token = tokens[idx]
  if (!token) return ''

  const code = token.content
  const lang = token.info?.trim() || ''
  const highlight = messageMarkdown.options.highlight

  if (highlight) {
    return highlight(code, lang, '')
  }

  return `<pre><code>${escapeHtml(code)}</code></pre>`
}

export function renderMessageMarkdown(content: string): string {
  return messageMarkdown.render(content)
}

export function handleMessageMarkdownClick(event: MouseEvent): void {
  const target = event.target as HTMLElement
  const button = target.closest('.copy-code-btn') as HTMLElement | null
  if (!button) return

  const code = button.getAttribute('data-code')
  if (!code) return

  navigator.clipboard.writeText(code).then(() => {
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
}
