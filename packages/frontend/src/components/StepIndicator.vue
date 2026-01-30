<script setup lang="ts">
/**
 * Step 进度指示器组件（底部折叠版）
 * 显示在输入框上方，展示模型调用信息
 */
import { ref, computed } from 'vue'
import type { Step, Task } from '../types/task'

interface Props {
  task: Task | null
  steps: Step[]
}

const props = defineProps<Props>()

const isExpanded = ref(false)

// Step 类型中文映射
const stepTypeNames: Record<string, string> = {
  plan: '分析',
  skill: '执行',
  mcp: '工具',
  think: '思考',
  respond: '生成'
}

// 模型名称映射
const modelNames: Record<string, string> = {
  'deepseek-chat': 'DeepSeek',
  'qwen-vl-plus': 'Qwen-VL',
  'qwen3-vl-flash': 'Qwen3-VL'
}

// 当前调用的模型
const currentModel = computed(() => {
  const skillStep = props.steps.find((s) => s.type === 'skill')
  if (skillStep?.output && typeof skillStep.output === 'object') {
    const output = skillStep.output as Record<string, unknown>
    const model = output.model as string
    return modelNames[model] || model || 'AI 模型'
  }
  return 'AI 模型'
})

// 当前状态文本
const statusText = computed(() => {
  if (!props.task) return ''
  if (props.task.status === 'completed') return '已完成'
  if (props.task.status === 'failed') return '已失败'

  const runningStep = props.steps.find((s) => s.status === 'running')
  if (runningStep) {
    return stepTypeNames[runningStep.type] || '处理中'
  }
  return '处理中'
})

// 是否已完成
const isCompleted = computed(() => props.task?.status === 'completed')

// 是否失败
const isFailed = computed(() => props.task?.status === 'failed')

// 总耗时
const totalDuration = computed(() => {
  if (!props.steps.length) return 0
  const firstStep = props.steps[0]
  const lastStep = props.steps[props.steps.length - 1]
  const start = firstStep?.startedAt || 0
  const end = lastStep?.completedAt || Date.now()
  return Math.round((end - start) / 1000)
})

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}秒`
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}分${secs}秒`
}

function toggleExpand() {
  isExpanded.value = !isExpanded.value
}
</script>

<template>
  <div v-if="task && steps.length > 0" class="step-panel" :class="{ expanded: isExpanded }">
    <!-- 折叠头部 -->
    <div class="step-header" @click="toggleExpand">
      <div class="header-left">
        <span class="model-badge">{{ currentModel }}</span>
        <span class="status-text" :class="{ completed: isCompleted, failed: isFailed }">
          {{ statusText }}
        </span>
        <span v-if="isCompleted || isFailed" class="duration">
          {{ formatDuration(totalDuration) }}
        </span>
      </div>
      <div class="header-right">
        <span class="step-count">{{ steps.length }} 个步骤</span>
        <span class="expand-icon" :class="{ rotated: isExpanded }">▼</span>
      </div>
    </div>

    <!-- 展开内容 -->
    <div v-show="isExpanded" class="step-content">
      <div class="steps-list">
        <div v-for="(step, index) in steps" :key="step.id" class="step-item" :class="step.status">
          <div class="step-left">
            <span class="step-number">{{ index + 1 }}</span>
            <span class="step-type">{{ stepTypeNames[step.type] || step.name }}</span>
            <span v-if="step.description" class="step-desc">{{ step.description }}</span>
          </div>
          <div class="step-right">
            <span v-if="step.error" class="error-badge">失败</span>
            <span v-else-if="step.status === 'completed'" class="success-badge">✓</span>
            <span v-else-if="step.status === 'running'" class="running-badge">
              <span class="dot"></span>
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.step-panel {
  background: var(--input-wrapper-bg);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  margin-bottom: 12px;
  overflow: hidden;
  transition: all 0.3s ease;
  width: 100%;
  max-width: 1200px;
  margin-left: auto;
  margin-right: auto;
}

.step-panel.expanded {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

/* 头部样式 */
.step-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  cursor: pointer;
  transition: background 0.2s;
  user-select: none;
}

.step-header:hover {
  background: var(--btn-secondary-hover);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.model-badge {
  font-size: 12px;
  font-weight: 600;
  padding: 4px 10px;
  background: var(--accent-color);
  color: white;
  border-radius: 12px;
}

.status-text {
  font-size: 13px;
  color: var(--text-color);
  font-weight: 500;
}

.status-text.completed {
  color: var(--success-color);
}

.status-text.failed {
  color: var(--error-color);
}

.duration {
  font-size: 12px;
  color: var(--text-secondary);
}

.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.step-count {
  font-size: 12px;
  color: var(--text-secondary);
}

.expand-icon {
  font-size: 10px;
  color: var(--text-secondary);
  transition: transform 0.3s ease;
}

.expand-icon.rotated {
  transform: rotate(180deg);
}

/* 内容区域 */
.step-content {
  border-top: 1px solid var(--border-color);
  padding: 12px 14px;
  animation: slideDown 0.3s ease;
}

@keyframes slideDown {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.steps-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.step-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--bg-color);
  transition: all 0.2s;
}

.step-item.running {
  background: var(--accent-color);
 opacity: 0.1; /* ✅ 正确：设置元素整体透明度 */
  box-shadow: 0 0 0 1px var(--accent-color);
}

.step-item.failed {
  background: var(--error-color);
  opacity: 0.1; /* ✅ 正确：设置元素整体透明度 */
  box-shadow: 0 0 0 1px var(--error-color);
}

.step-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.step-number {
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--btn-secondary-bg);
  border-radius: 50%;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-color);
}

.step-type {
  font-size: 13px;
  color: var(--text-color);
  font-weight: 500;
}

.step-desc {
  font-size: 11px;
  color: var(--text-secondary);
}

.step-right {
  display: flex;
  align-items: center;
}

.success-badge {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--success-color);
  color: white;
  border-radius: 50%;
  font-size: 12px;
}

.error-badge {
  font-size: 11px;
  padding: 2px 8px;
  background: var(--error-color);
  color: white;
  border-radius: 4px;
}

.running-badge {
  display: flex;
  align-items: center;
  justify-content: center;
}

.dot {
  width: 8px;
  height: 8px;
  background: var(--accent-color);
  border-radius: 50%;
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.5;
    transform: scale(0.8);
  }
}
</style>
