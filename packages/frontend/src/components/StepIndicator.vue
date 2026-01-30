<script setup lang="ts">
/**
 * Step 进度指示器组件
 * 可视化展示 Task 的执行步骤
 */
import type { Step, Task } from '../types/task';

interface Props {
  task: Task | null;
  steps: Step[];
}

defineProps<Props>();

// Step 类型图标映射
const stepIcons: Record<string, string> = {
  plan: '📋',
  skill: '⚡',
  mcp: '🔧',
  think: '💭',
  respond: '💬',
};

// Step 状态样式映射
const statusClasses: Record<string, string> = {
  pending: 'step-pending',
  running: 'step-running',
  completed: 'step-completed',
  failed: 'step-failed',
};

function formatDuration(startedAt?: number, completedAt?: number): string {
  if (!startedAt) return '';
  const end = completedAt || Date.now();
  const duration = end - startedAt;
  if (duration < 1000) return `${duration}ms`;
  return `${(duration / 1000).toFixed(1)}s`;
}
</script>

<template>
  <div v-if="task && steps.length > 0" class="step-indicator">
    <div class="step-header">
      <span class="task-type">{{ task.type.toUpperCase() }}</span>
      <span class="task-status" :class="statusClasses[task.status]">
        {{ task.status }}
      </span>
    </div>

    <div class="steps-list">
      <div
        v-for="(step, index) in steps"
        :key="step.id"
        class="step-item"
        :class="[
          statusClasses[step.status],
          { 'step-active': step.status === 'running' }
        ]"
      >
        <!-- 步骤序号和图标 -->
        <div class="step-left">
          <span class="step-number">{{ index + 1 }}</span>
          <span class="step-icon">{{ stepIcons[step.type] || '🔹' }}</span>
        </div>

        <!-- 步骤信息 -->
        <div class="step-content">
          <div class="step-name">{{ step.name }}</div>
          <div v-if="step.description" class="step-description">
            {{ step.description }}
          </div>
          <div v-if="step.error" class="step-error">
            {{ step.error }}
          </div>
        </div>

        <!-- 步骤状态和时间 -->
        <div class="step-right">
          <span class="step-status-badge" :class="statusClasses[step.status]">
            {{ step.status }}
          </span>
          <span v-if="step.startedAt" class="step-duration">
            {{ formatDuration(step.startedAt, step.completedAt) }}
          </span>
        </div>

        <!-- 连接线 -->
        <div
          v-if="index < steps.length - 1"
          class="step-connector"
          :class="{ 'connector-active': step.status === 'completed' }"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.step-indicator {
  background: var(--message-ai-bg);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 16px;
}

.step-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-color);
}

.task-type {
  font-size: 12px;
  font-weight: 600;
  color: var(--accent-color);
  letter-spacing: 0.5px;
}

.task-status {
  font-size: 11px;
  padding: 4px 8px;
  border-radius: 4px;
  text-transform: uppercase;
  font-weight: 500;
}

.steps-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.step-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px;
  border-radius: 8px;
  background: var(--bg-color);
  position: relative;
  transition: all 0.3s ease;
}

.step-item.step-running {
  background: var(--accent-color);
  background-opacity: 0.1;
  box-shadow: 0 0 0 2px var(--accent-color);
}

.step-item.step-completed {
  opacity: 0.8;
}

.step-item.step-failed {
  background: var(--error-color);
  background-opacity: 0.1;
  box-shadow: 0 0 0 2px var(--error-color);
}

.step-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.step-number {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--btn-secondary-bg);
  border-radius: 50%;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-color);
}

.step-icon {
  font-size: 16px;
}

.step-content {
  flex: 1;
  min-width: 0;
}

.step-name {
  font-weight: 500;
  color: var(--text-color);
  margin-bottom: 2px;
}

.step-description {
  font-size: 12px;
  color: var(--text-secondary);
}

.step-error {
  font-size: 12px;
  color: var(--error-color);
  margin-top: 4px;
}

.step-right {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  flex-shrink: 0;
}

.step-status-badge {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  text-transform: uppercase;
}

.step-duration {
  font-size: 11px;
  color: var(--text-secondary);
}

/* 状态样式 */
.step-pending {
  background: var(--btn-secondary-bg);
  color: var(--text-secondary);
}

.step-running {
  background: var(--accent-color);
  color: white;
}

.step-completed {
  background: var(--success-color);
  color: white;
}

.step-failed {
  background: var(--error-color);
  color: white;
}

/* 连接线 */
.step-connector {
  position: absolute;
  left: 28px;
  top: 100%;
  width: 2px;
  height: 12px;
  background: var(--border-color);
  transition: background 0.3s ease;
}

.connector-active {
  background: var(--success-color);
}

/* 动画 */
@keyframes pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.6;
  }
}

.step-running .step-number {
  animation: pulse 1.5s ease-in-out infinite;
}
</style>
