<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { RefreshCw, LogOut, X, ArrowUpRight, Square, Trash2, FileText, Search } from '@lucide/vue'
import { useWorkspace } from '../features/workspace/useWorkspace'
const emit = defineEmits<{
  openTask: [taskId: string]
  stopViewing: []
  updateOpen: [open: boolean]
}>()
const props = defineProps<{ open: boolean; viewing: boolean; view?: 'tasks' | 'files' | 'usage' }>()
const tab = ref<'tasks' | 'files' | 'usage'>('tasks')
watch(
  () => props.view,
  (view) => {
    tab.value = view ?? 'tasks'
  },
  { immediate: true }
)
const query = ref('')
function openTask(id: string) {
  emit('updateOpen', false)
  emit('openTask', id)
}
function onToggle(event: Event) {
  const open = (event.target as HTMLDetailsElement).open
  if (open !== props.open) emit('updateOpen', open)
  if (open) void refresh()
}
const {
  tasks,
  files,
  usage,
  username,
  guest,
  pending,
  error,
  confirmDelete,
  operations,
  refresh,
  logout,
  cancel,
  removeFile
} = useWorkspace()
const status = (value: string) =>
  ({
    pending: '等待执行',
    running: '执行中',
    completed: '已完成',
    failed: '失败/中断',
    cancelled: '已取消'
  })[value] ?? value
const filteredTasks = computed(() =>
  tasks.value.filter((task) => task.userMessage.toLowerCase().includes(query.value.toLowerCase()))
)
const filteredFiles = computed(() =>
  files.value.filter((file) =>
    (file.fileName ?? '').toLowerCase().includes(query.value.toLowerCase())
  )
)
function handleTabKeydown(event: KeyboardEvent) {
  const tabs = ['tasks', 'files', 'usage'] as const
  let index = tabs.indexOf(tab.value)
  if (event.key === 'ArrowRight') index = (index + 1) % tabs.length
  else if (event.key === 'ArrowLeft') index = (index + tabs.length - 1) % tabs.length
  else if (event.key === 'Home') index = 0
  else if (event.key === 'End') index = tabs.length - 1
  else return
  event.preventDefault()
  tab.value = tabs[index]!
  const element = event.currentTarget as HTMLElement
  element.querySelector<HTMLElement>(`#${tab.value}-tab`)?.focus()
}
</script>
<template>
  <details class="workspace-panel" :open="open" @toggle="onToggle">
    <summary>
      <span>任务与文件</span><span class="workspace-owner">{{ username }}</span>
    </summary>
    <div class="workspace-body">
      <div class="workspace-toolbar">
        <div
          class="workspace-tabs"
          role="tablist"
          aria-label="工作空间"
          @keydown="handleTabKeydown"
        >
          <button
            id="tasks-tab"
            role="tab"
            :tabindex="tab === 'tasks' ? 0 : -1"
            :aria-selected="tab === 'tasks'"
            aria-controls="workspace-content"
            @click="tab = 'tasks'"
          >
            任务 <span>{{ tasks.length }}</span>
          </button>
          <button
            id="files-tab"
            role="tab"
            :tabindex="tab === 'files' ? 0 : -1"
            :aria-selected="tab === 'files'"
            aria-controls="workspace-content"
            @click="tab = 'files'"
          >
            文件 <span>{{ files.length }}</span>
          </button>
          <button
            id="usage-tab"
            role="tab"
            :tabindex="tab === 'usage' ? 0 : -1"
            :aria-selected="tab === 'usage'"
            aria-controls="workspace-content"
            @click="tab = 'usage'"
          >
            用量
          </button>
        </div>
        <div class="workspace-actions">
          <button
            class="icon-button"
            title="刷新记录"
            aria-label="刷新记录"
            :disabled="pending"
            @click="refresh"
          >
            <RefreshCw :class="{ spin: pending }" />
          </button>
          <button
            v-if="viewing"
            class="icon-button"
            title="停止查看，后台继续"
            aria-label="停止查看"
            @click="emit('stopViewing')"
          >
            <Square />
          </button>
          <button
            v-if="!guest"
            class="icon-button"
            title="退出账户"
            aria-label="退出账户"
            :disabled="operations.has('logout')"
            @click="logout"
          >
            <LogOut />
          </button>
          <button
            class="icon-button"
            title="关闭面板"
            aria-label="关闭面板"
            @click="emit('updateOpen', false)"
          >
            <X />
          </button>
        </div>
      </div>
      <p v-if="error" role="alert" class="status-banner is-error">{{ error }}</p>
      <div id="workspace-content" role="tabpanel" :aria-labelledby="tab + '-tab'">
        <label v-if="tab !== 'usage'" class="workspace-search"
          ><Search /><input
            v-model="query"
            :placeholder="tab === 'tasks' ? '搜索任务' : '搜索文件'"
            :aria-label="tab === 'tasks' ? '搜索任务' : '搜索文件'"
        /></label>
        <template v-if="tab === 'tasks'">
          <p v-if="!filteredTasks.length" class="workspace-empty">
            {{ pending ? '加载中…' : query ? '没有匹配的任务' : '暂无任务' }}
          </p>
          <ul class="task-history">
            <li v-for="task in filteredTasks" :key="task.id">
              <div class="record-copy">
                <strong>{{ task.userMessage || '资料分析' }}</strong>
                <small
                  ><span :class="'record-status ' + task.status">{{ status(task.status) }}</span> ·
                  {{ new Date(task.createdAt).toLocaleString() }}</small
                >
              </div>
              <button class="button outline" @click="openTask(task.id)">
                <ArrowUpRight />打开 / 恢复
              </button>
              <button
                v-if="task.status === 'running' || task.status === 'pending'"
                class="icon-button danger"
                title="取消后台任务"
                aria-label="取消后台任务"
                :disabled="operations.has('task:' + task.id)"
                @click="cancel(task.id)"
              >
                <Square />
              </button>
            </li>
          </ul>
        </template>
        <template v-else-if="tab === 'files'">
          <p v-if="!filteredFiles.length" class="workspace-empty">
            {{ pending ? '加载中…' : query ? '没有匹配的文件' : '暂无文件' }}
          </p>
          <ul class="task-history">
            <li v-for="file in filteredFiles" :key="file.fileId">
              <FileText class="record-icon" />
              <div class="record-copy">
                <strong>{{ file.fileName || '未命名文件' }}</strong>
                <small
                  >{{ (file.bytes / 1024).toFixed(1) }} KiB ·
                  {{
                    file.status === 'complete'
                      ? '已上传'
                      : file.status === 'expired'
                        ? '已过期'
                        : '上传中'
                  }}</small
                >
              </div>
              <template v-if="confirmDelete === file.fileId">
                <button
                  class="button outline"
                  :disabled="operations.has('file:' + file.fileId)"
                  @click="removeFile(file.fileId)"
                >
                  确认删除
                </button>
                <button class="button" @click="confirmDelete = ''">保留</button>
              </template>
              <button
                v-else
                class="icon-button danger"
                title="删除文件"
                aria-label="删除文件"
                @click="removeFile(file.fileId)"
              >
                <Trash2 />
              </button>
            </li>
          </ul>
          <p class="workspace-note">删除文件会影响尚未读取它的任务，已保存的结果与引用仍保留。</p>
        </template>
        <template v-else>
          <dl v-if="usage" class="usage-list">
            <div>
              <dt>已计入预算</dt>
              <dd>{{ usage.chargedTokens.toLocaleString() }} token</dd>
            </div>
            <div>
              <dt>每日预算</dt>
              <dd>{{ usage.dailyTokenBudget.toLocaleString() }} token</dd>
            </div>
            <div>
              <dt>活动任务</dt>
              <dd>{{ usage.activeTasks }}</dd>
            </div>
          </dl>
          <p class="workspace-note">
            预算包含任务预留，不等于供应商账单。用量未知的中断请求保守计入预算。
          </p>
        </template>
      </div>
    </div>
  </details>
</template>
