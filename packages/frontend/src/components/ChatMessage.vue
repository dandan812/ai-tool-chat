<script setup lang="ts">
/**
 * 单条消息组件
 *
 * 目标：
 * - 强化用户消息与 AI 消息的层级差异
 * - 把操作入口收回消息头部，减少悬浮抖动
 * - 继续保留 Markdown 和代码复制能力
 *
 * @package frontend/src/components
 */

import { computed, ref } from 'vue'
import { handleMessageMarkdownClick, renderMessageMarkdown } from '../utils/messageMarkdown'
import { useChatStore } from '../stores/chat'
import type { EvidenceSource, TaskMetrics } from '../types/task'
import EvidenceSources from './EvidenceSources.vue'
import { presentTaskMetrics } from '../utils/evidencePresentation'
import { MessageSquare, Trash2, LoaderCircle } from '@lucide/vue'

interface Props {
  /** 消息角色 */
  role: 'user' | 'assistant' | 'system'
  /** 消息内容 */
  content: string
  /** 消息索引 */
  index: number
  sources?: EvidenceSource[]
  metrics?: TaskMetrics
}

const props = defineProps<Props>()
const store = useChatStore()

const emit = defineEmits<{
  /** 删除消息 */
  delete: [index: number]
}>()

/** 渲染后的 HTML */
const htmlContent = computed(() =>
  renderMessageMarkdown(
    props.content,
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

/** AI 空消息占位态 */
const showPendingPlaceholder = computed(() => {
  return (
    props.role === 'assistant' &&
    !props.content.trim() &&
    !!store.currentSessionId &&
    store.isSessionLoading(store.currentSessionId)
  )
})
</script>

<template>
  <article class="message-row" :class="{ user: isUser, ai: !isUser }">
    <div v-if="!isUser" class="avatar" :aria-label="roleLabel"><MessageSquare /></div>
    <div class="message-frame">
      <div class="message-meta">
        <span class="role-badge">{{ roleLabel }}</span>
        <button
          class="icon-button danger delete-btn"
          title="删除消息"
          aria-label="删除消息"
          @click="emit('delete', index)"
        >
          <Trash2 />
        </button>
      </div>
      <div class="bubble">
        <div v-if="showPendingPlaceholder" class="pending-placeholder" role="status">
          <LoaderCircle class="spin" />正在生成…
        </div>
        <div
          v-else
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
    </div>
  </article>
</template>
