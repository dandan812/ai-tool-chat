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

import { computed, watch } from 'vue'
import { useChatStore } from '../stores/chat'
import { useScroll, useVirtualScroll } from '../composables/useScroll'
import ChatMessage from './ChatMessage.vue'
import ChatWelcome from './ChatWelcome.vue'

// 当消息条数超过这个阈值后，启用虚拟滚动。
// 目的不是“提前优化一切”，而是只在长对话场景下减少 DOM 压力。
const VIRTUAL_SCROLL_THRESHOLD = 100

// 虚拟滚动需要一个“估算消息高度”来推算可见区范围。
// 这里是经验值，不要求每条消息都精确相等。
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
const { container, isAtBottom, scrollToBottom, shouldAutoScroll } = useScroll()

// useVirtualScroll 负责：
// - 计算当前应该渲染哪一段消息
// - 计算上下占位高度
const virtualScroll = useVirtualScroll(ESTIMATED_MESSAGE_HEIGHT, VIRTUAL_OVERSCAN)

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

// 当前可见区范围：
// - startIndex：从哪条消息开始渲染
// - endIndex：渲染到哪条消息结束
// - offsetY：上方占位高度
const virtualRange = computed(() => {
  return virtualScroll.getVisibleRange(displayMessages.value.length)
})

/**
 * 真正交给模板 v-for 渲染的消息数组
 *
 * - 普通模式：渲染全部 displayMessages
 * - 虚拟滚动模式：只渲染当前可见区附近的一小段
 */
const virtualMessages = computed(() => {
  if (!shouldUseVirtualScroll.value) {
    return displayMessages.value
  }

  return displayMessages.value.slice(virtualRange.value.startIndex, virtualRange.value.endIndex)
})

// 虚拟滚动上方占位高度。
// 因为上方消息并未真实渲染，需要一个空白块把滚动条高度“补回来”。
const topSpacerHeight = computed(() => {
  return shouldUseVirtualScroll.value ? virtualRange.value.offsetY : 0
})

// 虚拟滚动下方占位高度。
const bottomSpacerHeight = computed(() => {
  if (!shouldUseVirtualScroll.value) {
    return 0
  }

  const remainingCount = displayMessages.value.length - virtualRange.value.endIndex
  return Math.max(0, remainingCount * ESTIMATED_MESSAGE_HEIGHT)
})

/** 是否显示回到底部按钮 */
const showScrollButton = computed(() => {
  return displayMessages.value.length > 2 && !isAtBottom.value
})

// 当消息条数变化时，通常意味着：
// - 新增了一条用户消息
// - 或插入了一条 assistant 占位消息
// 这时直接滚到底部，让用户看到最新区域。
watch(() => displayMessages.value.length, () => {
  scrollToBottom()
})

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
 * 这个容器需要同时交给两套逻辑：
 * 1. useScroll：自动滚动、底部判断
 * 2. useVirtualScroll：计算可见区和占位高度
 */
function setMessageContainer(
  element:
    | Element
    | import('vue').ComponentPublicInstance
    | null,
) {
  const htmlElement = element instanceof HTMLElement ? element : null
  container.value = htmlElement
  virtualScroll.container.value = htmlElement
}
</script>

<template>
  <!--
    主消息滚动容器：
    - 整个消息区在这里纵向滚动
    - 同时作为自动滚动与虚拟滚动的真实 DOM 容器
  -->
  <main :ref="setMessageContainer" class="messages">
    <div class="messages-shell">
      <!--
        当当前会话还没有任何消息时，显示欢迎页而不是空白。
        欢迎页中的建议点击后会继续走 send 主链路。
      -->
      <ChatWelcome
        v-if="displayMessages.length === 0"
        @select="handleSuggestion"
      />

      <!--
        有消息时显示消息列表。
        开启虚拟滚动后，会额外挂上 is-virtual 类名调整布局策略。
      -->
      <div
        v-else
        class="message-list"
        :class="{ 'is-virtual': shouldUseVirtualScroll }"
      >
        <!-- 虚拟滚动上方占位 -->
        <div v-if="shouldUseVirtualScroll" class="virtual-spacer" :style="{ height: `${topSpacerHeight}px` }" />

        <!--
          逐条渲染当前需要展示的消息。
          注意 index 的处理：
          - 普通模式直接使用当前 index
          - 虚拟滚动模式需要加上 startIndex，才能映射回原始消息数组位置
        -->
        <ChatMessage
          v-for="(message, index) in virtualMessages"
          :key="`${shouldUseVirtualScroll ? virtualRange.startIndex + index : index}-${message.role}`"
          :index="shouldUseVirtualScroll ? virtualRange.startIndex + index : index"
          :role="message.role"
          :content="message.content"
          @delete="store.deleteMessage"
        />

        <!-- 虚拟滚动下方占位 -->
        <div v-if="shouldUseVirtualScroll" class="virtual-spacer" :style="{ height: `${bottomSpacerHeight}px` }" />
      </div>
    </div>

    <!--
      回到底部按钮：
      只有当消息足够多、且用户当前离开底部时才显示。
      这样既保留“看历史消息”的自由，又不会丢失回到底部的入口。
    -->
    <button
      v-show="showScrollButton"
      class="scroll-bottom-btn"
      type="button"
      @click="scrollToBottom()"
    >
      <span>回到底部</span>
      <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="7 13 12 18 17 13"></polyline>
        <polyline points="7 6 12 11 17 6"></polyline>
      </svg>
    </button>
  </main>
</template>

<style scoped>
/* 整个消息区本身就是滚动容器。 */
.messages {
  position: relative;
  flex: 1;
  height: 100%;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  padding: var(--space-4) var(--space-6) var(--space-6);
}

/* 统一欢迎页和消息列表的内容版心宽度。 */
.messages-shell {
  width: min(100%, var(--layout-content-max));
  margin: 0 auto;
}

/* 普通模式下，消息列表按列排布并保持统一间距。 */
.message-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  padding-bottom: var(--space-8);
}

/* 虚拟滚动模式下，不再依赖容器 gap，而改为单条消息自身带间距。 */
.message-list.is-virtual {
  gap: 0;
}

/* 虚拟滚动占位块本身只负责撑高滚动区域。 */
.virtual-spacer {
  flex: 0 0 auto;
}

/* 虚拟滚动时，给每条真实渲染的消息补回下边距。 */
.message-list.is-virtual :deep(.message-row) {
  margin-bottom: var(--space-6);
}

/* 回到底部按钮吸附在滚动区域底部附近。 */
.scroll-bottom-btn {
  position: sticky;
  left: 100%;
  bottom: var(--space-5);
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  margin-left: auto;
  padding: 0.8rem 0.95rem;
  border: 1px solid rgba(201, 106, 23, 0.16);
  border-radius: var(--radius-pill);
  background: var(--surface-panel);
  color: var(--text-secondary);
  box-shadow: var(--shadow-panel);
  cursor: pointer;
  backdrop-filter: blur(16px);
  transition: all var(--transition-fast);
}

/* 悬停时稍微上浮，给用户一个明确可点击反馈。 */
.scroll-bottom-btn:hover {
  color: var(--text-primary);
  transform: translateY(-1px);
}

/* 移动端收紧内边距，避免消息区显得过窄。 */
@media (max-width: 768px) {
  .messages {
    padding: var(--space-3) var(--space-4) var(--space-5);
  }

  .message-list {
    gap: var(--space-5);
  }

  .scroll-bottom-btn {
    bottom: var(--space-4);
    padding: 0.7rem 0.9rem;
  }
}
</style>
