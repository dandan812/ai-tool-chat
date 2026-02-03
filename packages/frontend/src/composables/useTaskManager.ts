import { ref, computed, shallowRef } from 'vue'
import type { Task, Step } from '../types/task'

/**
 * Task/Step 管理 Composable
 * 封装 Task 和 Step 的状态管理和更新逻辑
 */

interface TaskProgress {
  current: number
  total: number
  percentage: number
}

interface UseTaskManagerReturn {
  // 状态
  currentTask: import('vue').ShallowRef<Task | null>
  currentSteps: import('vue').Ref<Step[]>
  isProcessing: import('vue').Ref<boolean>
  
  // 计算属性
  progress: import('vue').ComputedRef<TaskProgress>
  currentStepName: import('vue').ComputedRef<string>
  
  // 方法
  startTask: (task: Task) => void
  updateTask: (task: Task) => void
  addStep: (step: Step) => void
  completeStep: (step: Step) => void
  reset: () => void
  getStepStatus: (stepId: string) => Step['status']
}

/**
 * 创建 Task 管理器
 */
export function useTaskManager(): UseTaskManagerReturn {
  // State - 使用 shallowRef 优化性能
  const currentTask = shallowRef<Task | null>(null)
  const currentSteps = ref<Step[]>([])
  const isProcessing = ref(false)

  // 计算属性
  const progress = computed<TaskProgress>(() => {
    if (!currentTask.value) {
      return { current: 0, total: 0, percentage: 0 }
    }

    const completedSteps = currentSteps.value.filter(s => s.status === 'completed').length
    const totalSteps = currentSteps.value.length || 3

    return {
      current: completedSteps,
      total: totalSteps,
      percentage: Math.round((completedSteps / totalSteps) * 100)
    }
  })

  const currentStepName = computed(() => {
    const current = currentSteps.value.find(s => s.status === 'running')
    return current?.name || current?.type || '处理中...'
  })

  // ==================== 方法 ====================

  /**
   * 开始新 Task
   */
  function startTask(task: Task): void {
    currentTask.value = task
    currentSteps.value = []
    isProcessing.value = true
  }

  /**
   * 更新 Task 状态
   */
  function updateTask(task: Task): void {
    currentTask.value = { ...currentTask.value, ...task }
  }

  /**
   * 添加新 Step
   */
  function addStep(step: Step): void {
    // 检查是否已存在
    const index = currentSteps.value.findIndex(s => s.id === step.id)
    if (index === -1) {
      currentSteps.value.push(step)
    } else {
      currentSteps.value[index] = { ...currentSteps.value[index], ...step }
    }
  }

  /**
   * 完成 Step
   */
  function completeStep(step: Step): void {
    const index = currentSteps.value.findIndex(s => s.id === step.id)
    if (index !== -1) {
      currentSteps.value[index] = { 
        ...currentSteps.value[index], 
        ...step,
        status: 'completed',
        completedAt: step.completedAt || Date.now()
      }
    }
  }

  /**
   * 获取 Step 状态
   */
  function getStepStatus(stepId: string): Step['status'] {
    const step = currentSteps.value.find(s => s.id === stepId)
    return step?.status || 'pending'
  }

  /**
   * 重置所有状态
   */
  function reset(): void {
    currentTask.value = null
    currentSteps.value = []
    isProcessing.value = false
  }

  return {
    currentTask,
    currentSteps,
    isProcessing,
    progress,
    currentStepName,
    startTask,
    updateTask,
    addStep,
    completeStep,
    reset,
    getStepStatus
  }
}

/**
 * 创建 Task 回调处理器（适配 sendTaskRequest）
 */
export function createTaskCallbacks(manager: ReturnType<typeof useTaskManager>) {
  return {
    onTaskStart: (task: Task) => {
      manager.startTask(task)
    },
    
    onTaskUpdate: (task: Task) => {
      manager.updateTask(task)
    },
    
    onStepStart: (step: Step) => {
      manager.addStep(step)
    },
    
    onStepComplete: (step: Step) => {
      manager.completeStep(step)
    },
    
    onComplete: () => {
      manager.isProcessing.value = false
    },
    
    onError: () => {
      manager.isProcessing.value = false
    }
  }
}
