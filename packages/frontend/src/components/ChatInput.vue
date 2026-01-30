<script setup lang="ts">
/**
 * 聊天输入组件（多模态版）
 * 支持文本输入、图片上传、快捷键发送
 */
import { ref, computed } from 'vue'
import type { ImageData } from '../types/task'
import ImageUploader from './ImageUploader.vue'

// ==================== Props & Emits ====================

/**
 * 组件 Props 定义
 * @property loading - 是否正在加载中，控制按钮显示状态
 */
interface Props {
  loading?: boolean
}

const props = defineProps<Props>()

/**
 * 组件事件定义
 * @event send - 发送消息事件，携带文本内容和图片数组
 * @event stop - 停止生成事件
 */
const emit = defineEmits<{
  send: [content: string, images: ImageData[]]
  stop: []
}>()

// ==================== 输入状态 ====================

/** 输入框文本内容 */
const input = ref('')

/** 已上传的图片数组 */
const images = ref<ImageData[]>([])

/** 是否显示图片上传区域 */
const showImageUploader = ref(false)

/**
 * 是否可以发送消息
 * 条件：有文本内容或有图片，且不在加载中
 */
const canSend = computed(() => {
  return (input.value.trim() || images.value.length > 0) && !props.loading
})

// ==================== 图片处理 ====================

/**
 * 添加图片到上传列表
 * @param image - 图片数据对象
 */
function addImage(image: ImageData) {
  images.value.push(image)
}

/**
 * 从上传列表移除图片
 * @param id - 图片唯一标识
 */
function removeImage(id: string) {
  images.value = images.value.filter((img) => img.id !== id)
}

// ==================== 发送处理 ====================

/**
 * 处理发送消息
 * 触发 send 事件并清空输入状态
 */
function handleSend() {
  if (!canSend.value) return

  // 触发发送事件，传递文本和图片
  emit('send', input.value.trim(), images.value)

  // 重置输入状态
  input.value = ''
  images.value = []
  showImageUploader.value = false
}

/**
 * 处理键盘按键事件
 * Enter 发送消息，Shift+Enter 换行
 * @param e - 键盘事件对象
 */
function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleSend()
  }
}

/**
 * 自动调整文本框高度
 * 根据内容行数动态调整，最大高度 200px
 * @param e - 输入事件对象
 */
function autoResize(e: Event) {
  const el = e.target as HTMLTextAreaElement
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 200)}px`
}
</script>

<template>
  <!-- 输入容器 -->
  <div class="input-container">
    <!-- 图片上传区域 - 点击 📷 按钮后显示 -->
    <div v-if="showImageUploader" class="uploader-wrapper">
      <ImageUploader :images="images" @add="addImage" @remove="removeImage" />
    </div>

    <!-- 输入框主体 -->
    <div class="input-wrapper">
      <!-- 左侧工具栏 -->
      <div class="toolbar">
        <!-- 图片上传按钮 -->
        <button
          class="toolbar-btn"
          :class="{ active: showImageUploader }"
          @click="showImageUploader = !showImageUploader"
          title="上传图片"
        >
          📷
        </button>
      </div>

      <!-- 文本输入框 -->
      <textarea
        v-model="input"
        :disabled="loading"
        placeholder="输入消息..."
        rows="1"
        class="chat-textarea"
        @keydown="handleKeydown"
        @input="autoResize"
      />

      <!-- 右侧操作按钮 -->
      <!-- 未加载时显示发送按钮 -->
      <button v-if="!loading" class="send-btn" :disabled="!canSend" @click="handleSend">
        发送
      </button>
      <!-- 加载中时显示停止按钮 -->
      <button v-else class="stop-btn" @click="emit('stop')">停止</button>
    </div>
  </div>
</template>

<style scoped>
/* 输入容器 - 底部固定区域 */
.input-container {
  padding: 16px 20px;
  background: var(--bg-color);
  border-top: 1px solid var(--border-color);
}

/* 图片上传区域包装器 */
.uploader-wrapper {
  margin-bottom: 12px;
  padding: 12px;
  background: var(--input-wrapper-bg);
  border-radius: 12px;
  border: 1px solid var(--border-color);
}

/* 输入框主体 - 圆角卡片样式 */
.input-wrapper {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  width: 100%;
  max-width: 1200px;
  margin: 0 auto;
  padding: 8px 12px;
  background: var(--input-wrapper-bg);
  border: 1px solid var(--border-color);
  border-radius: 20px;
  transition:
    border-color 0.2s,
    box-shadow 0.2s;
}

/* 聚焦状态 - 高亮边框 */
.input-wrapper:focus-within {
  border-color: var(--accent-color);
  box-shadow: 0 2px 10px rgba(59, 130, 246, 0.1);
}

/* 工具栏 - 左侧按钮组 */
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-right: 8px;
  border-right: 1px solid var(--border-color);
  height: 36px;
}

/* 工具栏按钮 */
.toolbar-btn {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: 8px;
  font-size: 24px;
  cursor: pointer;
  transition: all 0.2s;
  line-height: 1;
  padding: 0;
}

.toolbar-btn:hover {
  background: var(--btn-secondary-hover);
}

/* 工具栏按钮激活状态 */
.toolbar-btn.active {
  background: var(--btn-secondary-hover);
}

/* 文本输入框 - 自适应高度 */
.chat-textarea {
  flex: 1;
  min-height: 36px;
  max-height: 200px;
  padding: 10px 12px;
  font-family: inherit;
  font-size: 16px;
  line-height: 1.5;
  color: var(--text-color);
  background: transparent;
  border: none;
  resize: none;
  outline: none;
}

/* 发送按钮 */
.send-btn {
  padding: 10px 20px;
  font-size: 14px;
  font-weight: 500;
  color: white;
  background: var(--btn-primary-bg);
  border: none;
  border-radius: 16px;
  cursor: pointer;
  transition: all 0.2s;
}

.send-btn:hover:not(:disabled) {
  background: var(--btn-primary-hover);
  transform: translateY(-1px);
  box-shadow: 0 2px 4px rgba(59, 130, 246, 0.3);
}

/* 发送按钮禁用状态 */
.send-btn:disabled {
  background: var(--btn-secondary-bg);
  cursor: not-allowed;
}

/* 停止按钮 - 红色警示 */
.stop-btn {
  padding: 10px 20px;
  font-size: 14px;
  font-weight: 500;
  color: white;
  background: var(--error-color);
  border: none;
  border-radius: 16px;
  cursor: pointer;
  transition: all 0.2s;
}

.stop-btn:hover {
  background: var(--error-hover);
  transform: translateY(-1px);
  box-shadow: 0 2px 4px rgba(239, 68, 68, 0.3);
}
</style>
