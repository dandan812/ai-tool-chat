<script setup lang="ts">
/**
 * 单条消息组件
 *
 * 目标：
 * - 强化用户消息与 AI 消息的层级差异
 * - 在消息下方提供复制与删除，保持正文稳定
 * - 继续保留 Markdown 和代码复制能力
 *
 * @package frontend/src/components
 */

import { computed, onScopeDispose, ref } from 'vue'
import { handleMessageMarkdownClick, renderMessageMarkdown } from '../utils/messageMarkdown'
import { useChatStore } from '../stores/chat'
import type { EvidenceSource, MessageAttachment, TaskMetrics } from '../types/task'
import EvidenceSources from './EvidenceSources.vue'
import { presentTaskMetrics } from '../utils/evidencePresentation'
import { normalizeMessageAttachments, presentMessageAttachment } from '../utils/messageAttachments'
import { Copy, Check, Trash2, LoaderCircle, FileText, Image as ImageIcon } from '@lucide/vue'

interface Props {
  /** 消息角色 */
  role: 'user' | 'assistant' | 'system'
  /** 消息内容 */
  content: string
  /** 消息索引 */
  index: number
  sources?: EvidenceSource[]
  metrics?: TaskMetrics
  attachments?: MessageAttachment[]
  attachmentOnly?: boolean
}

const props = defineProps<Props>()
const store = useChatStore()

const emit = defineEmits<{
  /** 删除消息 */
  delete: [index: number]
}>()

/** 渲染后的 HTML */
const messageAttachments = computed(() =>
  props.role === 'user' ? normalizeMessageAttachments(props.attachments) : []
)
const messageText = computed(() =>
  props.attachmentOnly === true && messageAttachments.value.length ? '' : props.content
)
const copyContent = computed(
  () =>
    messageText.value || messageAttachments.value.map((attachment) => attachment.name).join('\n')
)
const htmlContent = computed(() =>
  renderMessageMarkdown(
    messageText.value,
    props.role === 'assistant' ? props.sources : [],
    props.role === 'assistant'
  )
)
const evidencePanel = ref<InstanceType<typeof EvidenceSources> | null>(null)
const metricPresentation = computed(() =>
  props.metrics ? presentTaskMetrics(props.metrics) : null
)
function onMarkdownClick(event: MouseEvent) {
  handleMessageMarkdownClick(event, {
    sources: props.role === 'assistant' ? props.sources : [],
    onEvidence: (sourceId) => {
      void evidencePanel.value?.openSource(sourceId)
    }
  })
}

/** 是否为用户消息 */
const isUser = computed(() => props.role === 'user')

/** 消息角色文案 */
const roleLabel = computed(() => (isUser.value ? '你' : 'AI 助手'))
const copied = ref(false)
const copyError = ref('')
let copyTimer: ReturnType<typeof setTimeout> | undefined
onScopeDispose(() => clearTimeout(copyTimer))
async function copyMessage() {
  try {
    await navigator.clipboard.writeText(copyContent.value)
    copyError.value = ''
    copied.value = true
    clearTimeout(copyTimer)
    copyTimer = setTimeout(() => (copied.value = false), 2000)
  } catch {
    copyError.value = '复制失败，请重试'
  }
}

/** AI 空消息占位态 */
const showPendingPlaceholder = computed(() => {
  return (
    props.role === 'assistant' &&
    !props.content.trim() &&
    !!store.currentSessionId &&
    store.isSessionLoading(store.currentSessionId)
  )
})
const hasMessageBody = computed(
  () =>
    showPendingPlaceholder.value ||
    !!messageText.value.trim() ||
    (props.role === 'assistant' && (!!props.sources?.length || !!metricPresentation.value))
)
</script>

<template>
  <article class="message-row" :class="{ user: isUser, ai: !isUser }">
    <div class="message-frame">
      <span class="sr-only">{{ roleLabel }}</span>
      <ul
        v-if="messageAttachments.length"
        class="message-attachments"
        :class="{ 'attachments-only': !messageText.trim() }"
        aria-label="消息附件"
      >
        <li
          v-for="(attachment, attachmentIndex) in messageAttachments"
          :key="attachmentIndex"
          class="message-attachment"
        >
          <span class="message-attachment-icon" aria-hidden="true">
            <ImageIcon v-if="attachment.kind === 'image'" />
            <FileText v-else />
          </span>
          <span class="message-attachment-info">
            <span class="message-attachment-name" :title="attachment.name">{{
              attachment.name
            }}</span>
            <span class="message-attachment-meta">{{ presentMessageAttachment(attachment) }}</span>
          </span>
        </li>
      </ul>
      <div v-if="hasMessageBody" class="bubble">
        <div v-if="showPendingPlaceholder" class="pending-placeholder" role="status">
          <LoaderCircle class="spin" />正在生成…
        </div>
        <div
          v-else-if="messageText.trim()"
          class="markdown-body"
          :class="{ 'user-text': isUser }"
          v-html="htmlContent"
          @click="onMarkdownClick"
        />
        <EvidenceSources
          v-if="role === 'assistant' && sources?.length"
          ref="evidencePanel"
          :sources="sources"
        />
        <details v-if="role === 'assistant' && metricPresentation" class="task-metrics">
          <summary>
            任务用量 · {{ metricPresentation.elapsed }} ·
            {{ metricPresentation.modelCalls }}模型调用
          </summary>
          <dl>
            <dt>首段内容</dt>
            <dd>{{ metricPresentation.firstContent }}</dd>
            <dt>Token 用量</dt>
            <dd>{{ metricPresentation.tokens }}</dd>
            <dt>费用</dt>
            <dd>{{ metricPresentation.cost }}</dd>
          </dl>
        </details>
      </div>
      <div v-if="!showPendingPlaceholder" class="message-actions">
        <button
          class="icon-button"
          :title="copied ? '已复制' : '复制消息'"
          :aria-label="copied ? '已复制' : '复制消息'"
          :disabled="!copyContent.trim()"
          @click="copyMessage"
        >
          <Check v-if="copied" /><Copy v-else />
        </button>
        <button
          class="icon-button danger delete-btn"
          title="删除消息"
          aria-label="删除消息"
          @click="emit('delete', index)"
        >
          <Trash2 />
        </button>
        <span v-if="copyError" role="status">{{ copyError }}</span>
      </div>
    </div>
  </article>
</template>

<style scoped>
.message-attachments {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: var(--space-2);
  margin: 0 0 var(--space-3);
  padding: 0;
  list-style: none;
}
.message-attachments.attachments-only {
  margin-bottom: 0;
}
.message-attachment {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: min(var(--attachment-item-width), 100%);
  min-width: 0;
  min-height: var(--attachment-item-height);
  padding: var(--space-2) var(--space-3);
  border: var(--border-width) solid var(--border-default);
  border-radius: var(--radius-md);
  background: var(--bg-primary);
  color: var(--text-primary);
}
.message-attachment-icon {
  display: grid;
  flex: 0 0 var(--attachment-preview-size);
  width: var(--attachment-preview-size);
  height: var(--attachment-preview-size);
  place-items: center;
  border-radius: var(--radius-sm);
  background: var(--bg-tertiary);
}
.message-attachment-icon svg {
  width: var(--icon-size-lg);
  height: var(--icon-size-lg);
}
.message-attachment-info {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-1);
  min-width: 0;
}
.message-attachment-name {
  overflow: hidden;
  font-size: var(--text-sm);
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.message-attachment-meta {
  color: var(--text-secondary);
  font-size: var(--text-xs);
}
</style>
