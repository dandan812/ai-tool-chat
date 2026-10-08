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
import { Check, LoaderCircle, CircleX, ChevronDown, Square } from '@lucide/vue'
import {
  formatTaskDuration,
  getActiveStepText,
  getCompletedStepCount,
  getStepTypeLabel,
  getTaskDurationSeconds
} from '../utils/taskPresentation'

interface Props {
  /** 当前任务对象 */
  task: Task | null
  /** 当前任务步骤 */
  steps: Step[]
}

const props = defineProps<Props>()

/** 控制明细展开状态 */
const isExpanded = ref(false)

/** 已完成步骤数量 */
const completedCount = computed(() => getCompletedStepCount(props.steps))

/** 当前步骤说明 */
const currentStepText = computed(() => getActiveStepText(props.steps, props.task))

/** 总耗时（秒） */
const totalDuration = computed(() => getTaskDurationSeconds(props.steps))

/** 是否可显示耗时 */
const showDuration = computed(() => totalDuration.value > 0)

/** 任务状态类名 */
const statusClass = computed(() => {
  if (props.task?.status === 'failed') return 'is-failed'
  if (props.task?.status === 'completed') return 'is-completed'
  if (props.task?.status === 'cancelled') return 'is-cancelled'
  return 'is-running'
})

/** 切换展开状态 */
function toggleExpand() {
  isExpanded.value = !isExpanded.value
}
</script>

<template>
  <section
    v-if="task && steps.length"
    class="activity-band"
    :class="[statusClass, { expanded: isExpanded }]"
  >
    <button class="band-summary" :aria-expanded="isExpanded" @click="toggleExpand">
      <span class="summary-main">
        <Check v-if="task.status === 'completed'" /><CircleX v-else-if="task.status === 'failed'" />
        <Square v-else-if="task.status === 'cancelled'" /><LoaderCircle v-else class="spin" />
        <span class="step-copy">{{ currentStepText }}</span>
      </span>
      <span class="summary-meta"
        ><span>{{ completedCount }}/{{ steps.length }}</span>
        <span v-if="showDuration">{{ formatTaskDuration(totalDuration) }}</span>
        <ChevronDown :class="{ rotated: isExpanded }"
      /></span>
    </button>
    <div v-show="isExpanded" class="band-details">
      <div class="timeline">
        <article
          v-for="step in steps"
          :key="step.id"
          class="timeline-item"
          :class="`status-${step.status}`"
        >
          <div class="timeline-head">
            <h3 class="timeline-title">{{ getStepTypeLabel(step.type, step.name) }}</h3>
            <span class="timeline-state">{{
              step.status === 'completed'
                ? '完成'
                : step.status === 'failed'
                  ? '失败'
                  : step.status === 'pending'
                    ? '等待'
                    : '执行中'
            }}</span>
          </div>
          <p v-if="step.description" class="timeline-desc">{{ step.description }}</p>
          <p v-if="step.error" class="timeline-error">{{ step.error }}</p>
        </article>
      </div>
    </div>
  </section>
</template>
