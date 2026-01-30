<script setup lang="ts">
/**
 * 单条消息组件
 * 功能：渲染用户/AI 消息、Markdown 解析、代码块复制功能
 */
import { computed } from 'vue'
// 引入 markdown-it 库，用于将 Markdown 文本转换为 HTML
import MarkdownIt from 'markdown-it'

// ==================== Props & Emits ====================

/** 组件 Props 定义 */
const props = defineProps<{
  /** 消息发送者角色：用户/AI/系统 */
  role: 'user' | 'assistant' | 'system'
  /** 消息文本内容 */
  content: string
  /** 消息在列表中的索引，用于删除操作 */
  index: number
}>()

/** 组件事件定义 */
const emit = defineEmits<{
  /** 删除消息事件，携带消息索引 */
  (e: 'delete', index: number): void
}>()

// ==================== Markdown 解析器配置 ====================

/**
 * 初始化 Markdown 解析器
 * - html: false 禁用 HTML 标签，防止 XSS 攻击
 * - linkify: true 自动识别 URL 并转换为链接
 * - breaks: true 将换行符转换为 <br>
 */
const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true
})

/**
 * 自定义代码块渲染逻辑
 * 为代码块添加头部（显示语言、复制按钮）
 */
const defaultRender =
  md.renderer.rules.fence ||
  function (tokens, idx, options, _env, self) {
    return self.renderToken(tokens, idx, options)
  }

md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const token = tokens[idx]
  if (!token) return ''

  // 转义引号防止 HTML 属性注入
  const code = token.content.replace(/"/g, '&quot;')
  const info = token.info ? token.info.trim() : ''
  const lang = info.split(/\s+/g)[0]

  const rawCode = defaultRender(tokens, idx, options, env, self)
  return `
    <div class="code-block-wrapper">
      <div class="code-block-header">
        <span class="code-lang">${lang || 'code'}</span>
        <button class="copy-code-btn" data-code="${code}">Copy</button>
      </div>
      ${rawCode}
    </div>
  `
}

// ==================== 计算属性 ====================

/**
 * 将 Markdown 文本转换为 HTML
 * 使用 computed 缓存，仅当 content 变化时重新计算
 */
const htmlContent = computed(() => {
  return md.render(props.content)
})

/**
 * 判断当前是否为用户消息
 * 用于动态控制样式和布局
 */
const isUser = computed(() => props.role === 'user')

// ==================== 事件处理 ====================

/**
 * 处理消息内容区域的点击事件（事件委托）
 * 实现代码块复制按钮功能
 */
function handleContentClick(e: MouseEvent) {
  const target = e.target as HTMLElement
  if (target.classList.contains('copy-code-btn')) {
    const code = target.getAttribute('data-code')
    if (code) {
      navigator.clipboard.writeText(code).then(() => {
        const originalText = target.innerText
        target.innerText = 'Copied!'
        target.classList.add('copied')
        // 2 秒后恢复按钮文字
        setTimeout(() => {
          target.innerText = originalText
          target.classList.remove('copied')
        }, 2000)
      })
    }
  }
}
</script>

<template>
  <!-- 消息容器：根据角色动态添加不同类名 -->
  <div class="message-container" :class="{ 'message-user': isUser, 'message-ai': !isUser }">
    <!-- 消息内容区域 -->
    <div class="message-content">
      <!-- AI 消息：使用 v-html 渲染 Markdown 转换后的 HTML -->
      <div
        v-if="!isUser"
        class="markdown-body"
        v-html="htmlContent"
        @click="handleContentClick"
      ></div>
      <!-- 用户消息：直接显示纯文本 -->
      <div v-else>{{ content }}</div>

      <!-- 悬浮操作按钮：鼠标悬停时显示 -->
      <div class="message-actions">
        <button @click="emit('delete', index)" class="action-btn" title="删除消息">🗑️</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ==================== 消息容器样式 ==================== */

.message-container {
  display: flex;
  gap: 12px;
  padding: 16px;
  max-width: 800px;
  margin: 0 auto;
  width: 100%;
}

/* 用户消息：内容靠右对齐 */
.message-user {
  flex-direction: row-reverse;
}

/* ==================== 头像样式（已移除） ==================== */

.avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--btn-secondary-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  flex-shrink: 0;
}

/* ==================== 消息内容区域样式 ==================== */

.message-content {
  background: var(--message-ai-bg);
  color: var(--text-color);
  padding: 12px 16px;
  border-radius: 12px;
  max-width: 80%;
  line-height: 1.6;
  word-wrap: break-word;
  position: relative; /* 为操作按钮定位 */
}

/* ==================== 悬浮操作按钮样式 ==================== */

.message-actions {
  position: absolute;
  bottom: -30px;
  left: 0;
  display: flex;
  gap: 8px;
  opacity: 0;
  transition: opacity 0.2s;
}

/* 用户消息的操作按钮靠右 */
.message-user .message-actions {
  left: auto;
  right: 0;
}

/* 鼠标悬停时显示操作按钮 */
.message-container:hover .message-actions {
  opacity: 1;
}

.action-btn {
  background: var(--bg-color);
  border: 1px solid var(--border-color);
  color: var(--text-color);
  border-radius: 4px;
  padding: 2px 6px;
  font-size: 14px;
  cursor: pointer;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.action-btn:hover {
  background: var(--btn-secondary-hover);
}

/* ==================== 用户消息样式 ==================== */

.message-user .message-content {
  background: var(--message-user-bg);
  color: var(--message-user-text);
  border-radius: 12px 0 12px 12px;
}

/* ==================== AI 消息样式 ==================== */

.message-ai .message-content {
  background: var(--message-ai-bg);
  color: var(--text-color);
  border-radius: 0 12px 12px 12px;
}

/* ==================== Markdown 内容样式 ==================== */

/* 优化滚动性能 */
:deep(.markdown-body) {
  will-change: transform;
  backface-visibility: hidden;
  transform: translateZ(0);
}

/* 代码块样式 */
:deep(.markdown-body pre) {
  background: #f3f4f6;
  color: #1f2937;
  padding: 16px;
  border-radius: 0 0 8px 8px;
  overflow-x: auto;
  margin: 0;
  font-family: Consolas, Menlo, Monaco, 'Courier New', monospace;
  white-space: pre;
  line-height: 1.5;
  font-size: 14px;
  will-change: transform;
}

/* 代码块包装器 */
:deep(.code-block-wrapper) {
  margin: 16px 0;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid #e5e7eb;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  will-change: transform;
  backface-visibility: hidden;
  transform: translateZ(0);
}

/* 代码块头部 */
:deep(.code-block-header) {
  background: #e5e7eb;
  color: #6b7280;
  padding: 8px 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  font-family: sans-serif;
  border-bottom: 1px solid #e5e7eb;
}

/* 代码语言标签 */
:deep(.code-lang) {
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* 复制按钮 */
:deep(.copy-code-btn) {
  background: #374151;
  border: 1px solid #4b5563;
  color: #e5e7eb;
  padding: 4px 12px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
  font-size: 11px;
  min-width: 70px;
}

:deep(.copy-code-btn:hover) {
  background: #4b5563;
  color: #ffffff;
  border-color: #6b7280;
}

/* 复制成功状态 */
:deep(.copy-code-btn.copied) {
  background: #10b981;
  color: #ffffff;
  border-color: #10b981;
}

/* 行内代码样式 */
:deep(.markdown-body code) {
  background: var(--btn-secondary-bg);
  color: var(--text-color);
  padding: 2px 4px;
  border-radius: 4px;
}

/* 段落样式 */
:deep(.markdown-body p) {
  margin: 0 0 8px 0;
}

:deep(.markdown-body p:last-child) {
  margin-bottom: 0;
}

/* ==================== 深色模式适配 ==================== */

[data-theme='dark'] :deep(.markdown-body pre),
[data-theme='dark'] :deep(.markdown-body pre *) {
  background: #000000 !important;
  color: #d4d4d4 !important;
}

[data-theme='dark'] :deep(.code-block-wrapper) {
  border: 1px solid #333333 !important;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
}

[data-theme='dark'] :deep(.code-block-header),
[data-theme='dark'] :deep(.code-block-header *) {
  background: #1a1a1a !important;
  color: #cccccc !important;
  border-bottom: 1px solid #333333 !important;
}
</style>
