<script setup lang="ts">
/**
 * 执行步骤指示器
 *
 * 目标：
 * - 默认以高信号摘要展示当前执行状态
 * - 展开后提供时间线式步骤明细
 * - 与输入区共享同一套视觉语言
 *
 * @package frontend/src/components
 */

import { computed, ref } from 'vue'
import type { Step, Task } from '../types/task'

interface Props {
  /** 当前任务对象 */
  task: Task | null
  /** 当前任务步骤 */
  steps: Step[]
}

const props = defineProps<Props>()

/** 控制明细展开状态 */
const isExpanded = ref(false)

/** 步骤名称映射 */
const stepTypeNames: Record<string, string> = {
  plan: '分析请求',
  skill: '调用模型',
  mcp: '执行工具',
  think: '组织回答',
  respond: '生成内容'
}

/** 模型名称映射 */
const modelNames: Record<string, string> = {
  'deepseek-chat': 'DeepSeek',
  'qwen3.5-plus': 'Qwen 3.5 Plus',
  'qwen3.5-flash': 'Qwen 3.5 Flash',
  'qwen3.5-flash-2026-02-23': 'Qwen 3.5 Flash',
  'qwen3.5-122b-a10b': 'Qwen 3.5 122B',
  'qwen3-vl-flash-2026-01-22': 'Qwen 3 VL Flash',
  'qwen3-max-2026-01-23': 'Qwen 3 Max',
  'qwen3-vl-plus': 'Qwen VL Plus',
  'qwen-vl-plus': 'Qwen VL Plus',
  'glm-5': 'GLM-5'
}

/** 当前模型 */
const currentModel = computed(() => {
  const taskModel = props.task?.metadata?.model
  if (typeof taskModel === 'string' && taskModel) {
    return modelNames[taskModel] || taskModel
  }

  const skillStep = props.steps.find((step) => step.type === 'skill')
  const outputModel =
    skillStep?.output && typeof skillStep.output === 'object'
      ? (skillStep.output as Record<string, unknown>).model
      : null

  return typeof outputModel === 'string' && outputModel
    ? modelNames[outputModel] || outputModel
    : '等待调度'
})

/** 当前活跃步骤 */
const activeStep = computed(() => {
  return (
    props.steps.find((step) => step.status === 'running') ??
    props.steps[props.steps.length - 1] ??
    null
  )
})

/** 已完成步骤数量 */
const completedCount = computed(() => {
  return props.steps.filter((step) => step.status === 'completed').length
})

/** 状态文案 */
const statusText = computed(() => {
  if (!props.task) return '等待执行'
  if (props.task.status === 'failed') return '执行失败'
  if (props.task.status === 'completed') return '已完成'
  return activeStep.value ? '执行中' : '准备中'
})

/** 当前步骤说明 */
const currentStepText = computed(() => {
  if (!activeStep.value) return '等待新的任务开始'

  if (activeStep.value.description) {
    return activeStep.value.description
  }

  return stepTypeNames[activeStep.value.type] || activeStep.value.name
})

/** 总耗时（秒） */
const totalDuration = computed(() => {
  if (!props.steps.length) return 0

  const firstStep = props.steps[0]
  const lastStep = props.steps[props.steps.length - 1]
  const start = firstStep?.startedAt || 0
  const end = lastStep?.completedAt || Date.now()

  return Math.max(0, Math.round((end - start) / 1000))
})

/** 是否可显示耗时 */
const showDuration = computed(() => totalDuration.value > 0)

/** 任务状态类名 */
const statusClass = computed(() => {
  if (props.task?.status === 'failed') return 'is-failed'
  if (props.task?.status === 'completed') return 'is-completed'
  return 'is-running'
})

/**
 * 格式化耗时
 * @param seconds 秒数
 */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`

  const minutes = Math.floor(seconds / 60)
  const remainSeconds = seconds % 60
  return `${minutes} 分 ${remainSeconds} 秒`
}

/** 切换展开状态 */
function toggleExpand() {
  isExpanded.value = !isExpanded.value
}
</script>

<template>
  <section
    v-if="task && steps.length > 0"
    class="activity-band"
    :class="[statusClass, { expanded: isExpanded }]"
  >
    <button
      class="band-summary"
      type="button"
      :aria-expanded="isExpanded"
      @click="toggleExpand"
    >
      <div class="summary-main">
        <span class="model-chip">{{ currentModel }}</span>
        <span class="status-pill">{{ statusText }}</span>
        <p class="step-copy">{{ currentStepText }}</p>
      </div>

      <div class="summary-meta">
        <span class="meta-item">{{ completedCount }}/{{ steps.length }} 步</span>
        <span v-if="showDuration" class="meta-item">{{ formatDuration(totalDuration) }}</span>
        <span class="expand-toggle">
          {{ isExpanded ? '收起' : '详情' }}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            :class="{ rotated: isExpanded }"
          >
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </span>
      </div>
    </button>

    <div v-show="isExpanded" class="band-details">
      <div class="timeline">
        <article
          v-for="(step, index) in steps"
          :key="step.id"
          class="timeline-item"
          :class="`status-${step.status}`"
        >
          <div class="timeline-rail">
            <span class="timeline-dot"></span>
            <span v-if="index !== steps.length - 1" class="timeline-line"></span>
          </div>

          <div class="timeline-card">
            <div class="timeline-head">
              <div class="timeline-title-group">
                <span class="timeline-index">0{{ index + 1 }}</span>
                <h3 class="timeline-title">
                  {{ stepTypeNames[step.type] || step.name }}
                </h3>
              </div>

              <span class="timeline-state">
                {{ step.status === 'completed' ? '完成' : step.status === 'failed' ? '失败' : '进行中' }}
              </span>
            </div>

            <p v-if="step.description" class="timeline-desc">{{ step.description }}</p>
            <p v-if="step.error" class="timeline-error">{{ step.error }}</p>
          </div>
        </article>
      </div>
    </div>
  </section>
</template>

<style scoped>
.activity-band {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-xl);
  background: linear-gradient(180deg, var(--surface-panel) 0%, var(--surface-strong) 100%);
  box-shadow: var(--shadow-panel);
  backdrop-filter: blur(20px);
  overflow: hidden;
}

.activity-band.is-running {
  border-color: rgba(201, 106, 23, 0.2);
}

.activity-band.is-completed {
  border-color: rgba(34, 197, 94, 0.2);
}

.activity-band.is-failed {
  border-color: rgba(239, 68, 68, 0.22);
}

.band-summary {
  width: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: var(--space-4);
  align-items: center;
  padding: var(--space-4) var(--space-5);
  background: transparent;
  border: none;
  cursor: pointer;
  text-align: left;
  transition: background-color var(--transition-fast);
}

.band-summary:hover {
  background: rgba(255, 255, 255, 0.18);
}

.summary-main {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.model-chip,
.status-pill,
.meta-item {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 28px;
  padding: 0.25rem 0.7rem;
  border-radius: var(--radius-pill);
  font-size: var(--text-xs);
  font-weight: 700;
  letter-spacing: 0.01em;
}

.model-chip {
  background: var(--accent-soft);
  color: var(--accent-primary);
}

.status-pill {
  background: var(--surface-muted);
  color: var(--text-secondary);
}

.activity-band.is-completed .status-pill {
  background: var(--success-soft);
  color: var(--success-dark);
}

.activity-band.is-failed .status-pill {
  background: var(--danger-soft);
  color: var(--error);
}

.step-copy {
  min-width: min(100%, 260px);
  flex: 1 1 320px;
  color: var(--text-primary);
  font-size: var(--text-sm);
  font-weight: 600;
  line-height: 1.5;
}

.summary-meta {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex-wrap: wrap;
  justify-content: flex-end;
}

.meta-item {
  background: transparent;
  color: var(--text-tertiary);
  padding-inline: 0;
  min-height: auto;
}

.expand-toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  color: var(--text-secondary);
  font-size: var(--text-xs);
  font-weight: 700;
}

.expand-toggle svg {
  transition: transform var(--transition-fast);
}

.expand-toggle svg.rotated {
  transform: rotate(180deg);
}

.band-details {
  border-top: 1px solid var(--border-subtle);
  padding: 0 var(--space-5) var(--space-5);
}

.timeline {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding-top: var(--space-4);
}

.timeline-item {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr);
  gap: var(--space-3);
}

.timeline-rail {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.timeline-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--border-default);
  box-shadow: 0 0 0 4px rgba(120, 113, 108, 0.08);
}

.timeline-line {
  flex: 1;
  width: 1px;
  margin-top: var(--space-1);
  background: var(--border-subtle);
}

.timeline-item.status-running .timeline-dot {
  background: var(--accent-primary);
  box-shadow: 0 0 0 4px var(--accent-soft);
}

.timeline-item.status-completed .timeline-dot {
  background: var(--success);
  box-shadow: 0 0 0 4px var(--success-soft);
}

.timeline-item.status-failed .timeline-dot {
  background: var(--error);
  box-shadow: 0 0 0 4px var(--danger-soft);
}

.timeline-card {
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  background: var(--surface-strong);
}

.timeline-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
}

.timeline-title-group {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.timeline-index {
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  font-weight: 700;
}

.timeline-title {
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  font-weight: 700;
  color: var(--text-primary);
}

.timeline-state {
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  font-weight: 700;
  flex-shrink: 0;
}

.timeline-item.status-running .timeline-state {
  color: var(--accent-primary);
}

.timeline-item.status-completed .timeline-state {
  color: var(--success-dark);
}

.timeline-item.status-failed .timeline-state {
  color: var(--error);
}

.timeline-desc,
.timeline-error {
  margin-top: var(--space-2);
  font-size: var(--text-sm);
  line-height: 1.6;
}

.timeline-desc {
  color: var(--text-secondary);
}

.timeline-error {
  color: var(--error);
}

@media (max-width: 768px) {
  .band-summary {
    grid-template-columns: 1fr;
    padding: var(--space-4);
  }

  .summary-meta {
    justify-content: flex-start;
  }

  .band-details {
    padding: 0 var(--space-4) var(--space-4);
  }
}
</style>
