<script setup lang="ts">
/**
 * Step 进度指示器组件（底部折叠版）
 * 显示在输入框上方，展示模型调用信息和任务执行步骤
 *
 * 功能特性：
 * - 显示当前任务状态和模型信息
 * - 可折叠查看详细的步骤列表
 * - 显示每个步骤的状态（运行中/完成/失败）
 * - 计算并显示总耗时
 *
 * @package frontend/src/components
 */

import { ref, computed } from 'vue'
import type { Step, Task } from '../types/task'

/**
 * 组件属性
 */
interface Props {
  /** 当前任务对象 */
  task: Task | null
  /** 步骤列表 */
  steps: Step[]
}

const props = defineProps<Props>()

/** 控制面板展开/折叠状态 */
const isExpanded = ref(false)

/**
 * Step 类型中文映射表
 * 将内部步骤类型转换为中文显示名称
 */
const stepTypeNames: Record<string, string> = {
  plan: '分析',
  skill: '执行',
  mcp: '工具',
  think: '思考',
  respond: '生成'
}

/**
 * 模型名称映射表
 * 将内部模型 ID 转换为友好的显示名称
 */
const modelNames: Record<string, string> = {
  'deepseek-chat': 'DeepSeek',
  'qwen-vl-plus': 'Qwen-VL',
  'qwen3-vl-flash': 'Qwen3-VL'
}

/**
 * 计算属性：当前使用的 AI 模型
 * 从 skill 步骤的输出中提取模型信息
 */
const currentModel = computed(() => {
  const skillStep = props.steps.find((s) => s.type === 'skill')
  if (skillStep?.output && typeof skillStep.output === 'object') {
    const output = skillStep.output as Record<string, unknown>
    const model = output.model as string
    return modelNames[model] || model || 'AI 模型'
  }
  return 'AI 模型'
})

/**
 * 计算属性：当前状态文本
 * 根据任务状态和运行中的步骤显示不同的状态描述
 */
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

/**
 * 计算属性：任务是否已完成
 */
const isCompleted = computed(() => props.task?.status === 'completed')

/**
 * 计算属性：任务是否失败
 */
const isFailed = computed(() => props.task?.status === 'failed')

/**
 * 计算属性：总耗时（秒）
 * 计算从第一个步骤开始到最后一个步骤结束的总时长
 */
const totalDuration = computed(() => {
  if (!props.steps.length) return 0
  const firstStep = props.steps[0]
  const lastStep = props.steps[props.steps.length - 1]
  const start = firstStep?.startedAt || 0
  const end = lastStep?.completedAt || Date.now()
  return Math.round((end - start) / 1000)
})

/**
 * 格式化时长显示
 * @param seconds 秒数
 * @returns 格式化的时间字符串（如 "5秒" 或 "2分30秒"）
 */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}秒`
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  return `${mins}分${secs}秒`
}

/**
 * 切换展开/折叠状态
 * 用于显示或隐藏详细的步骤列表
 */
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
  border: 2px solid var(--border-color);
  border-radius: 16px;
  margin-bottom: 14px;
  overflow: hidden;
  transition: var(--transition);
  width: 100%;
  max-width: 800px;
  margin-left: auto;
  margin-right: auto;
  box-shadow: var(--card-shadow);
}

.step-panel.expanded {
  box-shadow: var(--card-shadow-hover), var(--glow-shadow);
  border-color: var(--accent-color);
}

/* 头部样式 */
.step-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  /* padding: 12px 16px; */
  cursor: pointer;
  transition: var(--transition);
  user-select: none;
}

.step-header:hover {
  background: var(--btn-secondary-hover);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.model-badge {
  font-size: 12px;
  font-weight: 700;
  padding: 6px 12px;
  background: var(--btn-primary-bg);
  color: white;
  border-radius: 14px;
  letter-spacing: 0.3px;
  box-shadow: var(--card-shadow);
}

.status-text {
  font-size: 13px;
  color: var(--text-color);
  font-weight: 600;
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
  font-weight: 500;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.step-count {
  font-size: 12px;
  color: var(--text-secondary);
  font-weight: 500;
}

.expand-icon {
  font-size: 10px;
  color: var(--text-secondary);
  transition: transform 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94);
}

.expand-icon.rotated {
  transform: rotate(180deg);
}

/* 内容区域 */
.step-content {
  border-top: 1.5px solid var(--border-color);
  padding: 14px 16px;
  animation: slideDown 0.4s ease-out;
}

@keyframes slideDown {
  from {
    opacity: 0;
    transform: translateY(-12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.steps-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.step-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 14px;
  border-radius: 12px;
  background: var(--bg-color);
  transition: var(--transition);
  border: 1.5px solid transparent;
}

.step-item:hover {
  border-color: var(--border-color);
  box-shadow: var(--card-shadow);
}

.step-item.running {
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.15) 0%, rgba(139, 92, 246, 0.15) 100%);
  box-shadow:
    0 0 0 2px var(--accent-color),
    var(--glow-shadow);
  animation: stepPulse 2s ease-in-out infinite;
}

.step-item.failed {
  background: linear-gradient(135deg, rgba(239, 68, 68, 0.15) 0%, rgba(249, 115, 22, 0.15) 100%);
  box-shadow: 0 0 0 2px var(--error-color);
}

.step-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.step-number {
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--btn-secondary-bg);
  border-radius: 50%;
  font-size: 12px;
  font-weight: 700;
  color: var(--text-color);
  box-shadow: var(--card-shadow);
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
  padding: 4px 10px;
  background: var(--error-color);
  color: white;
  border-radius: 8px;
  font-weight: 600;
}

.running-badge {
  display: flex;
  align-items: center;
  justify-content: center;
}

.dot {
  width: 10px;
  height: 10px;
  background: var(--accent-color);
  border-radius: 50%;
  animation: pulse 1.5s ease-in-out infinite;
  box-shadow: 0 0 10px var(--accent-color);
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
