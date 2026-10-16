<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { ChevronDown, FileText } from '@lucide/vue'
import type { EvidenceSource } from '../types/task'
import { evidenceAllowlist } from '../utils/evidencePresentation'

const props = defineProps<{ sources: EvidenceSource[] }>()
const sources = computed(() => [...evidenceAllowlist(props.sources).values()])
const selectedId = ref<string | null>(null)
const selected = computed(() =>
  sources.value.find((source) => source.sourceId === selectedId.value)
)
const expanded = ref(false)
const panel = ref<HTMLElement | null>(null)

async function openSource(id: string) {
  if (!sources.value.some((source) => source.sourceId === id)) return
  selectedId.value = id
  expanded.value = true
  await nextTick()
  panel.value?.focus({ preventScroll: true })
  panel.value?.scrollIntoView?.({ behavior: 'auto', block: 'nearest' })
}

watch(sources, (value) => {
  if (selectedId.value && !value.some((source) => source.sourceId === selectedId.value)) {
    selectedId.value = null
    expanded.value = false
  }
})
defineExpose({ openSource })
</script>

<template>
  <section v-if="sources.length" class="evidence-sources" aria-label="本次回答的原文来源">
    <button
      type="button"
      class="sources-toggle"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
    >
      <FileText />{{ sources.length }} 个原文片段<ChevronDown :class="{ rotated: expanded }" />
    </button>
    <div v-if="expanded" class="sources-body">
      <p class="evidence-note">
        引用可核对，不代表结论已被自动验证。行号是提取文本的位置，不是 PDF 页码。
      </p>
      <div class="source-list" aria-label="选择来源">
        <button
          v-for="(source, index) in sources"
          :key="source.sourceId"
          type="button"
          class="source-option"
          :class="{ selected: selectedId === source.sourceId }"
          :aria-pressed="selectedId === source.sourceId"
          @click="openSource(source.sourceId)"
        >
          <span>来源 {{ index + 1 }}</span
          ><span class="file-name">{{ source.fileName }}</span>
        </button>
      </div>
      <div
        v-if="selected"
        ref="panel"
        tabindex="-1"
        class="source-excerpt"
        aria-label="选中的原文片段"
      >
        <div class="source-heading">
          <strong>{{ selected.fileName }}</strong>
          <span>提取文本第 {{ selected.startLine }}–{{ selected.endLine }} 行</span>
        </div>
        <pre>{{ selected.excerpt }}</pre>
      </div>
      <p v-else class="evidence-note">选择一个来源查看原文。</p>
    </div>
  </section>
</template>

<style scoped>
.evidence-sources {
  margin-top: var(--space-3);
  border-top: var(--border-width) solid var(--border-subtle);
  padding-top: var(--space-3);
}
.sources-toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--text-secondary);
  background: transparent;
  border: 0;
  border-radius: var(--radius-sm);
  padding: var(--space-1) 0;
  min-height: var(--control-height);
  cursor: pointer;
  font: inherit;
  font-size: var(--text-xs);
}
.sources-toggle svg {
  width: var(--icon-size);
  height: var(--icon-size);
}
.sources-body {
  margin-top: var(--space-3);
}
.evidence-note {
  color: var(--text-secondary);
  font-size: var(--text-sm);
  line-height: 1.6;
  margin: var(--space-2) 0;
}
.source-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin: var(--space-3) 0;
}
.source-option {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-2);
  text-align: left;
  max-width: 100%;
  min-height: var(--control-height);
  padding: var(--space-1) var(--space-2);
  border: var(--border-width) solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--surface-muted);
  color: var(--text-secondary);
  cursor: pointer;
  font: inherit;
  font-size: var(--text-sm);
}
.source-option.selected {
  border-color: var(--accent-primary);
  color: var(--accent-text);
  background: var(--accent-soft);
}
.file-name,
.source-heading strong {
  overflow-wrap: anywhere;
  min-width: 0;
}
.source-excerpt {
  border-left: var(--focus-width) solid var(--accent-primary);
  padding: var(--space-3);
  background: var(--surface-muted);
  border-radius: var(--radius-sm);
}
.source-heading {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-3);
  font-size: var(--text-sm);
  color: var(--text-secondary);
}
.source-excerpt pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: var(--excerpt-max-height);
  overflow-y: auto;
  font: inherit;
  font-size: var(--text-sm);
  line-height: 1.75;
  color: var(--text-primary);
  margin: var(--space-3) 0 0;
}
button:focus-visible,
.source-excerpt:focus {
  outline: var(--focus-width) solid var(--accent-primary);
  outline-offset: var(--space-1);
}
</style>
