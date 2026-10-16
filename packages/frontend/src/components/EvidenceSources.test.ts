import { createApp, h, nextTick, ref, type App } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import type { EvidenceSource } from '../types/task'
import EvidenceSources from './EvidenceSources.vue'

let app: App | undefined
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.innerHTML = ''
})

describe('EvidenceSources interaction', () => {
  it('opens the selected excerpt as escaped Vue text, clears removed account sources, and ignores unknown IDs', async () => {
    const source: EvidenceSource = {
      sourceId: 'trusted-source',
      fileId: 'file',
      fileHash: 'hash',
      fileName: '<img src=x onerror=alert(1)>.txt',
      excerpt: '<script>alert(1)</script>\r\noriginal text',
      startLine: 4,
      endLine: 5,
      startOffset: 20,
      endOffset: 80
    }
    const sources = ref([source])
    const panel = ref<InstanceType<typeof EvidenceSources>>()
    const root = document.createElement('div')
    document.body.append(root)
    app = createApp({
      setup: () => () => h(EvidenceSources, { ref: panel, sources: sources.value })
    })
    app.mount(root)
    expect(root.querySelector('.source-excerpt')).toBeNull()
    await panel.value?.openSource('not-in-this-message')
    expect(root.querySelector('.source-excerpt')).toBeNull()
    await panel.value?.openSource(source.sourceId)
    await nextTick()
    expect(root.querySelector('pre')?.textContent).toBe(source.excerpt)
    expect(root.querySelector('.source-heading strong')?.textContent).toBe(source.fileName)
    expect(root.querySelector('img, script')).toBeNull()
    expect(root.textContent).toContain('不是 PDF 页码')
    expect(root.textContent).toContain('4–5 行')
    expect(document.activeElement).toBe(root.querySelector('.source-excerpt'))
    sources.value = []
    await nextTick()
    expect(root.querySelector('pre')).toBeNull()
  })
})
