<script setup lang="ts">
/**
 * 消息列表组件
 *
 * 这个组件负责中间“消息流”区域的展示层逻辑。
 * 它不直接请求后端，也不负责维护聊天主状态，而是专门做这几件事：
 *
 * 1. 没有消息时显示欢迎页，有消息时显示消息列表
 * 2. 根据当前会话的流式状态，拼出“当前屏幕真正应该显示的消息内容”
 * 3. 管理滚动体验：自动滚到底、回到底部按钮、长列表虚拟滚动
 *
 * 可以把它理解成：
 * - Store 提供原始状态
 * - ChatMessages 把原始状态转换成“适合当前页面展示的状态”
 *
 * @package frontend/src/components
 */

import { computed, nextTick, onScopeDispose, watch } from 'vue'
import { useChatStore } from '../stores/chat'
import { useScroll } from '../composables/useScroll'
import { useVirtualizer } from '@tanstack/vue-virtual'
import ChatMessage from './ChatMessage.vue'
import ChatWelcome from './ChatWelcome.vue'
import { ArrowDown } from '@lucide/vue'

// 当消息条数超过这个阈值后，启用虚拟滚动。
// 目的不是“提前优化一切”，而是只在长对话场景下减少 DOM 压力。
const VIRTUAL_SCROLL_THRESHOLD = 100

// 只用于尚未渲染的消息；渲染后由 ResizeObserver 测量实际高度。
const ESTIMATED_MESSAGE_HEIGHT = 220

// 在可见区上下额外多渲染几条消息，避免快速滚动时出现明显白屏。
const VIRTUAL_OVERSCAN = 8

const emit = defineEmits<{
  /** 发送消息 */
  send: [content: string]
}>()

// 全局聊天状态都来自 Pinia。
const store = useChatStore()

// useScroll 负责：
// - 持有滚动容器引用
// - 判断当前是否已在底部
// - 提供滚到底部的方法
// - 判断当前是否适合自动滚动
const { container, isAtBottom, scrollToBottom, scrollToTop, shouldAutoScroll } = useScroll()

/**
 * 展示中的消息列表
 *
 * 这里要区分两个概念：
 * 1. `store.messages`：会话里保存的原始消息数组
 * 2. `displayMessages`：当前页面真正要拿来渲染的消息数组
 *
 * 为什么不能直接渲染 `store.messages`？
 * 因为流式输出时，某一条 assistant 消息会不断被追加内容。
 * 当前屏幕应该优先显示最新的 `streamingContent`，而不是只看原始数组。
 */
const displayMessages = computed(() => {
  const sessionId = store.currentSessionId
  if (!sessionId) return []

  return store.messages.map((message, index) => {
    // 如果这条消息正好是“当前正在流式生成的消息”，
    // 就用 streamingContent 覆盖它的显示内容。
    if (
      store.streamingContent?.sessionId === sessionId &&
      store.streamingContent?.index === index
    ) {
      return {
        ...message,
        content: store.streamingContent.content
      }
    }

    return message
  })
})

// 是否启用虚拟滚动。
const shouldUseVirtualScroll = computed(() => {
  return displayMessages.value.length >= VIRTUAL_SCROLL_THRESHOLD
})

const virtualizer = useVirtualizer(
  computed(() => ({
    count: displayMessages.value.length,
    enabled: shouldUseVirtualScroll.value,
    getScrollElement: () => container.value,
    getItemKey: (index: number) =>
      `${store.currentSessionId}:${displayMessages.value[index]?.id ?? index}`,
    estimateSize: () => ESTIMATED_MESSAGE_HEIGHT,
    overscan: VIRTUAL_OVERSCAN,
    gap: 28,
    paddingStart: 24,
    paddingEnd: 24
  }))
)
const virtualItems = computed(() => virtualizer.value.getVirtualItems())

function measureMessage(element: Element | import('vue').ComponentPublicInstance | null) {
  if (element instanceof HTMLElement) virtualizer.value.measureElement(element)
}

// Width changes invalidate measurements for offscreen Markdown too.
const resizeObserver = new ResizeObserver(() => virtualizer.value.measure())
watch(container, (element, previous) => {
  if (previous) resizeObserver.unobserve(previous)
  if (element) resizeObserver.observe(element)
})
onScopeDispose(() => resizeObserver.disconnect())

/** 是否显示回到底部按钮 */
const showScrollButton = computed(() => {
  return displayMessages.value.length > 2 && !isAtBottom.value
})

// 当消息条数变化时，通常意味着：
// - 新增了一条用户消息
// - 或插入了一条 assistant 占位消息
// 这时直接滚到底部，让用户看到最新区域。
watch(
  () => displayMessages.value.length,
  () => {
    if (displayMessages.value.length === 0) {
      void nextTick(() => {
        scrollToTop(true)
      })
      return
    }

    scrollToBottom()
  }
)

// 切换会话时，如果目标会话为空，说明当前应该展示欢迎页。
// 这时必须把滚动容器复位到顶部，否则会沿用上一会话的 scrollTop，
// 导致欢迎页从中间被裁开，看起来像布局错乱。
watch(
  () => store.currentSessionId,
  () => {
    void nextTick(() => {
      virtualizer.value.measure()
      if (displayMessages.value.length) void scrollToBottom(true)
      else scrollToTop(true)
    })
  }
)

// 当最后一条消息内容变化时，通常表示流式输出还在继续。
// 只有当用户当前接近底部时，才自动跟随滚动；
// 如果用户已经主动往上翻历史消息，就不要强拉到底部。
watch(
  () => displayMessages.value[displayMessages.value.length - 1]?.content,
  () => {
    if (shouldAutoScroll()) {
      scrollToBottom()
    }
  }
)

/**
 * 处理欢迎页建议点击
 *
 * 欢迎页里的建议文案，本质上也是“发送一条消息”。
 * 所以这里不自己处理业务，只是向父组件抛出 send 事件。
 */
function handleSuggestion(suggestion: string) {
  emit('send', suggestion)
}

/**
 * 绑定消息滚动容器
 *
 * 自动滚动和动态高度虚拟列表共享同一个滚动容器。
 */
function setMessageContainer(element: Element | import('vue').ComponentPublicInstance | null) {
  const htmlElement = element instanceof HTMLElement ? element : null
  container.value = htmlElement
}
</script>

<template>
  <main
    :ref="setMessageContainer"
    class="messages"
    :class="{ virtual: shouldUseVirtualScroll }"
    aria-label="对话消息"
  >
    <div class="messages-shell">
      <ChatWelcome v-if="!displayMessages.length" @select="handleSuggestion" />
      <div
        v-else-if="shouldUseVirtualScroll"
        class="virtual-message-list"
        :style="{ height: `${virtualizer.getTotalSize()}px` }"
      >
        <div
          v-for="item in virtualItems"
          :key="String(item.key)"
          :ref="measureMessage"
          :data-index="item.index"
          class="virtual-message"
          :style="{ transform: `translateY(${item.start}px)` }"
        >
          <ChatMessage
            :index="item.index"
            :role="displayMessages[item.index]!.role"
            :content="displayMessages[item.index]!.content"
            :sources="displayMessages[item.index]!.sources"
            :metrics="displayMessages[item.index]!.metrics"
            @delete="store.deleteMessage"
          />
        </div>
      </div>
      <div v-else class="message-list">
        <ChatMessage
          v-for="(message, index) in displayMessages"
          :key="message.id ?? `${index}-${message.role}`"
          :index="index"
          :role="message.role"
          :content="message.content"
          :sources="message.sources"
          :metrics="message.metrics"
          @delete="store.deleteMessage"
        />
      </div>
    </div>
    <button
      v-show="showScrollButton"
      class="icon-button scroll-bottom-btn"
      type="button"
      title="回到底部"
      aria-label="回到底部"
      @click="scrollToBottom()"
    >
      <ArrowDown />
    </button>
  </main>
</template>
