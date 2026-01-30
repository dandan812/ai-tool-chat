<script setup lang="ts">
/**
 * 聊天输入组件（多模态版）
 * 支持文本输入、图片上传
 */
import { ref, computed } from 'vue';
import type { ImageData } from '../types/task';
import ImageUploader from './ImageUploader.vue';

// ==================== Props & Emits ====================

interface Props {
  loading?: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  send: [content: string, images: ImageData[]];
  stop: [];
}>();

// ==================== 输入状态 ====================

const input = ref('');
const images = ref<ImageData[]>([]);
const showImageUploader = ref(false);

const canSend = computed(() => {
  return (input.value.trim() || images.value.length > 0) && !props.loading;
});

// ==================== 图片处理 ====================

function addImage(image: ImageData) {
  images.value.push(image);
}

function removeImage(id: string) {
  images.value = images.value.filter(img => img.id !== id);
}

// ==================== 发送处理 ====================

function handleSend() {
  if (!canSend.value) return;

  emit('send', input.value.trim(), images.value);

  // 重置输入
  input.value = '';
  images.value = [];
  showImageUploader.value = false;
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
}

// 自动调整高度
function autoResize(e: Event) {
  const el = e.target as HTMLTextAreaElement;
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
}
</script>

<template>
  <div class="input-container">
    <!-- 图片上传区域 -->
    <div v-if="showImageUploader" class="uploader-wrapper">
      <ImageUploader
        :images="images"
        @add="addImage"
        @remove="removeImage"
      />
    </div>

    <div class="input-wrapper">
      <!-- 工具栏 -->
      <div class="toolbar">
        <button
          class="toolbar-btn"
          :class="{ active: showImageUploader }"
          @click="showImageUploader = !showImageUploader"
          title="上传图片"
        >
          📷
        </button>
      </div>

      <!-- 文本输入 -->
      <textarea
        v-model="input"
        :disabled="loading"
        placeholder="输入消息..."
        rows="1"
        class="chat-textarea"
        @keydown="handleKeydown"
        @input="autoResize"
      />

      <!-- 发送/停止按钮 -->
      <button
        v-if="!loading"
        class="send-btn"
        :disabled="!canSend"
        @click="handleSend"
      >
        发送
      </button>
      <button
        v-else
        class="stop-btn"
        @click="emit('stop')"
      >
        停止
      </button>
    </div>
  </div>
</template>

<style scoped>
.input-container {
  padding: 16px 20px;
  background: var(--bg-color);
  border-top: 1px solid var(--border-color);
}

.uploader-wrapper {
  margin-bottom: 12px;
  padding: 12px;
  background: var(--input-wrapper-bg);
  border-radius: 12px;
  border: 1px solid var(--border-color);
}

.input-wrapper {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  max-width: 1000px;
  margin: 0 auto;
  padding: 8px 12px;
  background: var(--input-wrapper-bg);
  border: 1px solid var(--border-color);
  border-radius: 20px;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.input-wrapper:focus-within {
  border-color: var(--accent-color);
  box-shadow: 0 2px 10px rgba(59, 130, 246, 0.1);
}

/* 工具栏 */
.toolbar {
  display: flex;
  gap: 8px;
  padding-right: 8px;
  border-right: 1px solid var(--border-color);
}

.toolbar-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: 8px;
  font-size: 18px;
  cursor: pointer;
  transition: all 0.2s;
}

.toolbar-btn:hover {
  background: var(--btn-secondary-hover);
}

.toolbar-btn.active {
  background: var(--accent-color);
  background-opacity: 0.2;
}

/* 文本输入 */
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

/* 按钮 */
.send-btn,
.stop-btn {
  padding: 10px 20px;
  font-size: 14px;
  font-weight: 500;
  color: white;
  border: none;
  border-radius: 16px;
  cursor: pointer;
  transition: all 0.2s;
}

.send-btn {
  background: var(--btn-primary-bg);
}

.send-btn:hover:not(:disabled) {
  background: var(--btn-primary-hover);
  transform: translateY(-1px);
  box-shadow: 0 2px 4px rgba(59, 130, 246, 0.3);
}

.send-btn:disabled {
  background: var(--btn-secondary-bg);
  cursor: not-allowed;
}

.stop-btn {
  background: var(--error-color);
}

.stop-btn:hover {
  background: var(--error-hover);
  transform: translateY(-1px);
  box-shadow: 0 2px 4px rgba(239, 68, 68, 0.3);
}
</style>
