<script setup lang="ts">
import { computed, nextTick, ref, watch, type CSSProperties } from 'vue'
import { ElAlert } from 'element-plus/es/components/alert/index'
import { ElButton, type ButtonInstance } from 'element-plus/es/components/button/index'
import { ElInput } from 'element-plus/es/components/input/index'
import { ElSkeleton, ElSkeletonItem } from 'element-plus/es/components/skeleton/index'
import { ElTable, ElTableColumn } from 'element-plus/es/components/table/index'
import { ElTabs, ElTabPane } from 'element-plus/es/components/tabs/index'
import {
  RefreshCw,
  LogOut,
  X,
  ArrowUpRight,
  Square,
  Trash2,
  FileText,
  Search,
  ListTodo,
  Gauge
} from '@lucide/vue'
import 'element-plus/es/components/alert/style/css'
import 'element-plus/es/components/button/style/css'
import 'element-plus/es/components/input/style/css'
import 'element-plus/es/components/skeleton/style/css'
import 'element-plus/es/components/skeleton-item/style/css'
import 'element-plus/es/components/table/style/css'
import 'element-plus/es/components/table-column/style/css'
import 'element-plus/es/components/tabs/style/css'
import 'element-plus/es/components/tab-pane/style/css'
import 'element-plus/es/components/tooltip/style/css'
import { useWorkspace } from '../features/workspace/useWorkspace'
import { designPixels } from '../utils/designTokens'

const emit = defineEmits<{
  openTask: [taskId: string]
  stopViewing: []
  updateOpen: [open: boolean]
  updateView: [view: 'tasks' | 'files' | 'usage']
}>()
const props = defineProps<{
  open: boolean
  viewing: boolean
  view?: 'tasks' | 'files' | 'usage'
  modal?: boolean
}>()
const tab = ref<'tasks' | 'files' | 'usage'>('tasks')
const tabs = [
  { name: 'tasks', label: '任务', icon: ListTodo },
  { name: 'files', label: '文件', icon: FileText },
  { name: 'usage', label: '用量', icon: Gauge }
] as const
const query = ref('')
const columnWidth = {
  record: designPixels('--resource-record-min-width') || undefined,
  actions: designPixels('--resource-actions-width') || undefined,
  size: designPixels('--resource-size-width') || undefined,
  status: designPixels('--resource-status-width') || undefined,
  action: designPixels('--resource-action-width') || undefined
}
const panel = ref<HTMLElement>()
const confirmButton = ref<ButtonInstance>()
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

watch(
  () => props.view,
  (view) => {
    tab.value = view ?? 'tasks'
  },
  { immediate: true }
)
// useWorkspace already refreshes on mount, including when initially open.
watch(
  () => props.open,
  (open) => {
    if (open) void refresh()
  }
)
watch(confirmDelete, async (id) => {
  if (!id) return
  await nextTick()
  if (props.open && tab.value === 'files') confirmButton.value?.ref?.focus()
})
watch(tab, (view) => emit('updateView', view))

const search = computed(() => query.value.trim().toLowerCase())
const filteredTasks = computed(() =>
  tasks.value.filter((task) =>
    (task.userMessage || '资料分析').toLowerCase().includes(search.value)
  )
)
const filteredFiles = computed(() =>
  files.value.filter((file) => (file.fileName || '未命名文件').toLowerCase().includes(search.value))
)
const deletingFile = computed(() => files.value.find((file) => file.fileId === confirmDelete.value))
const loggingOut = computed(() => operations.value.has('logout'))
const emptyText = computed(() => {
  const records = tab.value === 'tasks' ? tasks.value : files.value
  const label = tab.value === 'tasks' ? '任务' : '文件'
  if (error.value && !records.length) return '记录暂不可用'
  return search.value && records.length ? `没有匹配的${label}` : `暂无${label}`
})
const tooltipOptions = {
  effect: 'light',
  popperStyle: {
    maxWidth: 'calc(100vw - var(--space-6))',
    overflowWrap: 'anywhere',
    fontSize: 'var(--text-xs)',
    color: 'var(--text-primary)',
    background: 'var(--bg-primary)',
    borderColor: 'var(--border-default)',
    borderRadius: 'var(--radius-sm)',
    padding: 'var(--space-2)',
    boxShadow: 'none'
  } satisfies CSSProperties
}
const taskStatus = (value: string) =>
  ({
    pending: '等待执行',
    running: '执行中',
    completed: '已完成',
    failed: '失败/中断',
    cancelled: '已取消'
  })[value] ?? value
const fileStatus = (value: string) =>
  value === 'complete' ? '已上传' : value === 'expired' ? '已过期' : '上传中'

function openTask(id: string) {
  emit('updateOpen', false)
  emit('openTask', id)
}
async function keepFile() {
  const id = confirmDelete.value
  confirmDelete.value = ''
  await nextTick()
  Array.from(panel.value?.querySelectorAll<HTMLButtonElement>('[data-file-id]') ?? [])
    .find((button) => button.dataset.fileId === id)
    ?.focus()
}
function handleTabKeydown(event: KeyboardEvent) {
  if (!(event.target instanceof HTMLElement) || event.target.getAttribute('role') !== 'tab') return
  const items = Array.from(
    (event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[role="tab"]')
  )
  let index = items.indexOf(event.target)
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') index = (index + 1) % items.length
  else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp')
    index = (index + items.length - 1) % items.length
  else if (event.key === 'Home') index = 0
  else if (event.key === 'End') index = items.length - 1
  else return
  event.preventDefault()
  event.stopPropagation()
  items[index]?.focus()
  items[index]?.click()
}
function handlePanelKeydown(event: KeyboardEvent) {
  if (
    !props.modal ||
    !props.open ||
    event.key !== 'Tab' ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey
  )
    return
  const elements = Array.from(
    panel.value?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), [tabindex="0"]'
    ) ?? []
  ).filter((element) => element.offsetParent !== null)
  const first = elements[0]
  const last = elements[elements.length - 1]
  if (event.shiftKey ? document.activeElement === first : document.activeElement === last) {
    event.preventDefault()
    event.stopPropagation()
    const target = event.shiftKey ? last : first
    target?.focus()
  }
}
</script>

<template>
  <aside
    v-show="open"
    ref="panel"
    class="workspace-panel workspace-resources"
    aria-label="工作空间"
    @keydown="handlePanelKeydown"
  >
    <header class="resource-header">
      <div class="resource-heading">
        <h2 tabindex="-1">
          {{ tab === 'files' ? '文件库' : tab === 'tasks' ? '任务记录' : '账户与用量' }}
        </h2>
        <span v-if="username" class="resource-owner" :title="username">{{ username }}</span>
      </div>
      <div class="resource-actions">
        <ElButton
          text
          class="resource-icon"
          title="刷新记录"
          aria-label="刷新记录"
          :disabled="pending || loggingOut"
          :aria-busy="pending"
          @click="refresh"
        >
          <RefreshCw aria-hidden="true" />
        </ElButton>
        <ElButton
          v-if="viewing"
          text
          class="resource-icon"
          title="停止查看，后台继续"
          aria-label="停止查看"
          @click="emit('stopViewing')"
        >
          <Square aria-hidden="true" />
        </ElButton>
        <ElButton
          v-if="!guest"
          text
          class="resource-icon"
          title="退出账户"
          aria-label="退出账户"
          :disabled="loggingOut"
          @click="logout"
        >
          <LogOut aria-hidden="true" />
        </ElButton>
        <ElButton
          text
          class="resource-icon"
          title="关闭面板"
          aria-label="关闭面板"
          @click="emit('updateOpen', false)"
        >
          <X aria-hidden="true" />
        </ElButton>
      </div>
    </header>

    <ElAlert v-if="error" class="resource-error" type="error" :title="error" :closable="false">
      <ElButton size="small" :disabled="pending || loggingOut" @click="refresh">重试</ElButton>
    </ElAlert>

    <ElTabs v-model="tab" class="resource-tabs" @keydown.capture="handleTabKeydown">
      <ElTabPane v-for="item in tabs" :key="item.name" :name="item.name" lazy>
        <template #label>
          <span class="resource-tab-label">
            <component :is="item.icon" aria-hidden="true" />
            <span>{{ item.label }}</span>
            <span v-if="item.name !== 'usage'" class="resource-count">
              {{ item.name === 'tasks' ? tasks.length : files.length }}
            </span>
          </span>
        </template>
        <section
          v-if="tab === item.name"
          class="resource-body"
          :aria-label="item.label"
          :aria-busy="pending"
        >
          <ElInput
            v-if="tab !== 'usage'"
            v-model="query"
            class="resource-search"
            clearable
            :placeholder="tab === 'tasks' ? '搜索任务' : '搜索文件'"
            :aria-label="tab === 'tasks' ? '搜索任务' : '搜索文件'"
          >
            <template #prefix><Search aria-hidden="true" /></template>
          </ElInput>

          <div v-if="pending" class="resource-loading" role="status">
            <span>{{
              tab === 'tasks' ? '加载任务中…' : tab === 'files' ? '加载文件中…' : '加载用量中…'
            }}</span>
            <ElSkeleton>
              <template #template>
                <ElSkeletonItem v-for="row in 4" :key="row" variant="text" />
              </template>
            </ElSkeleton>
          </div>

          <ElTable
            v-else-if="tab === 'tasks'"
            :data="filteredTasks"
            row-key="id"
            class="resource-table"
            size="small"
            table-layout="fixed"
            flexible
            :tooltip-options="tooltipOptions"
            aria-label="任务记录"
          >
            <ElTableColumn
              prop="userMessage"
              label="任务"
              :min-width="columnWidth.record"
              show-overflow-tooltip
            >
              <template #default="{ row }">
                <div class="resource-record">
                  <span class="resource-name" :title="row.userMessage || '资料分析'">
                    {{ row.userMessage || '资料分析' }}
                  </span>
                  <div class="resource-meta">
                    <span :class="['resource-status', row.status]">{{
                      taskStatus(row.status)
                    }}</span>
                    <time>
                      {{ new Date(row.createdAt).toLocaleString() }}
                    </time>
                  </div>
                </div>
              </template>
            </ElTableColumn>
            <ElTableColumn
              label="操作"
              :width="columnWidth.actions"
              align="right"
              class-name="resource-operation-cell"
            >
              <template #default="{ row }">
                <div class="resource-row-actions">
                  <ElButton
                    text
                    class="resource-icon"
                    title="打开 / 恢复任务"
                    :aria-label="'打开 / 恢复任务：' + (row.userMessage || '资料分析')"
                    :disabled="loggingOut || operations.has('task:' + row.id)"
                    @click="openTask(row.id)"
                  >
                    <ArrowUpRight aria-hidden="true" />
                  </ElButton>
                  <ElButton
                    v-if="row.status === 'running' || row.status === 'pending'"
                    text
                    class="resource-icon resource-danger"
                    title="取消后台任务"
                    :aria-label="'取消后台任务：' + (row.userMessage || '资料分析')"
                    :disabled="loggingOut || operations.has('task:' + row.id)"
                    :aria-busy="operations.has('task:' + row.id)"
                    @click="cancel(row.id)"
                  >
                    <Square aria-hidden="true" />
                  </ElButton>
                </div>
              </template>
            </ElTableColumn>
            <template #empty>
              <div class="resource-empty-state">
                <ListTodo aria-hidden="true" />
                <p class="resource-empty" role="status">{{ emptyText }}</p>
              </div>
            </template>
          </ElTable>

          <template v-else-if="tab === 'files'">
            <ElTable
              :data="filteredFiles"
              row-key="fileId"
              class="resource-table"
              size="small"
              table-layout="fixed"
              flexible
              :tooltip-options="tooltipOptions"
              aria-label="文件记录"
            >
              <ElTableColumn
                prop="fileName"
                label="文件名"
                :min-width="columnWidth.record"
                show-overflow-tooltip
              >
                <template #default="{ row }">
                  <div class="resource-file-name">
                    <FileText aria-hidden="true" />
                    <span class="resource-name" :title="row.fileName || '未命名文件'">
                      {{ row.fileName || '未命名文件' }}
                    </span>
                  </div>
                </template>
              </ElTableColumn>
              <ElTableColumn label="大小" :width="columnWidth.size" align="right">
                <template #default="{ row }">
                  <span class="resource-size">{{ (row.bytes / 1024).toFixed(1) }}</span>
                  <span class="resource-unit">KiB</span>
                </template>
              </ElTableColumn>
              <ElTableColumn label="状态" :width="columnWidth.status">
                <template #default="{ row }">
                  <span :class="['resource-status', row.status]">{{ fileStatus(row.status) }}</span>
                </template>
              </ElTableColumn>
              <ElTableColumn
                label="操作"
                :width="columnWidth.action"
                align="right"
                class-name="resource-operation-cell"
              >
                <template #default="{ row }">
                  <ElButton
                    text
                    class="resource-icon resource-danger"
                    title="删除文件"
                    :aria-label="'删除文件：' + (row.fileName || '未命名文件')"
                    :data-file-id="row.fileId"
                    :disabled="
                      loggingOut ||
                      confirmDelete === row.fileId ||
                      operations.has('file:' + row.fileId)
                    "
                    :aria-busy="operations.has('file:' + row.fileId)"
                    @click="removeFile(row.fileId)"
                  >
                    <Trash2 aria-hidden="true" />
                  </ElButton>
                </template>
              </ElTableColumn>
              <template #empty>
                <div class="resource-empty-state">
                  <FileText aria-hidden="true" />
                  <p class="resource-empty" role="status">{{ emptyText }}</p>
                </div>
              </template>
            </ElTable>
            <p class="resource-note">删除文件会影响尚未读取它的任务，已保存的结果与引用仍保留。</p>
          </template>

          <template v-else>
            <dl v-if="usage" class="resource-usage">
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
            <div v-else class="resource-empty-state">
              <Gauge aria-hidden="true" />
              <p class="resource-empty" role="status">
                {{ error ? '用量暂不可用' : '暂无用量记录' }}
              </p>
            </div>
            <p class="resource-note">
              预算包含任务预留，不等于供应商账单。用量未知的中断请求保守计入预算。
            </p>
          </template>
        </section>
      </ElTabPane>
    </ElTabs>

    <section
      v-if="tab === 'files' && deletingFile"
      class="resource-confirm"
      aria-label="删除文件二次确认"
    >
      <ElAlert
        type="warning"
        :closable="false"
        :title="'删除「' + (deletingFile.fileName || '未命名文件') + '」？'"
      >
        <div class="resource-confirm-actions">
          <ElButton
            ref="confirmButton"
            size="small"
            type="danger"
            :disabled="pending || loggingOut || operations.has('file:' + deletingFile.fileId)"
            :aria-busy="operations.has('file:' + deletingFile.fileId)"
            @click="removeFile(deletingFile.fileId)"
          >
            确认删除
          </ElButton>
          <ElButton
            size="small"
            :disabled="operations.has('file:' + deletingFile.fileId)"
            @click="keepFile"
          >
            保留
          </ElButton>
        </div>
      </ElAlert>
    </section>
  </aside>
</template>

<style scoped>
.workspace-panel.workspace-resources {
  display: flex;
  flex-direction: column;
  flex: 0 0 auto;
  box-sizing: border-box;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  border: 0;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: var(--text-sm);
  letter-spacing: 0;
  container-type: inline-size;
}
.resource-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  gap: var(--space-3);
  min-height: var(--layout-header-height);
  padding: var(--space-4);
  box-sizing: border-box;
}
.resource-heading,
.resource-actions,
.resource-row-actions,
.resource-file-name,
.resource-tab-label,
.resource-meta {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  min-width: 0;
}
.resource-heading {
  flex: 1;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-1);
}
.resource-heading h2 {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: 600;
  line-height: 1.5;
}
.resource-owner {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.resource-owner,
.resource-count,
.resource-meta,
.resource-unit {
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}
.resource-actions,
.resource-row-actions {
  flex-shrink: 0;
}
.resource-row-actions {
  justify-content: flex-end;
}
.resource-icon.el-button {
  width: var(--control-height);
  height: var(--control-height);
  min-width: var(--control-height);
  padding: 0;
  margin: 0;
  color: var(--text-secondary);
  border-radius: var(--radius-sm);
}
.resource-icon.el-button:not(:disabled):hover {
  color: var(--text-primary);
  background: var(--bg-secondary);
}
.resource-danger.el-button:not(:disabled):hover {
  color: var(--error);
  background: var(--danger-soft);
}
.resource-icon.el-button:disabled {
  color: var(--text-tertiary);
}
.resource-icon svg,
.resource-search :deep(svg),
.resource-file-name svg,
.resource-tab-label svg {
  flex-shrink: 0;
  width: var(--icon-size);
  height: var(--icon-size);
}
.resource-tab-label {
  gap: var(--space-2);
}
.resource-count {
  min-width: 1ch;
  font-variant-numeric: tabular-nums;
}
.resource-tabs {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
}
.resource-tabs :deep(.el-tabs__header) {
  flex-shrink: 0;
  margin: 0;
  padding: 0 var(--space-4);
}
.resource-tabs :deep(.el-tabs__nav-wrap::after) {
  height: var(--border-width);
  background: var(--border-subtle);
}
.resource-tabs :deep(.el-tabs__item) {
  height: calc(var(--control-height) + var(--space-2));
  padding: 0 var(--space-3);
  font-size: var(--text-sm);
  color: var(--text-secondary);
}
.resource-tabs :deep(.el-tabs__item.is-active) {
  color: var(--text-primary);
  font-weight: 600;
}
.resource-tabs :deep(.el-tabs__item:hover) {
  color: var(--text-primary);
}
.resource-tabs :deep(.el-tabs__active-bar) {
  background: var(--text-primary);
}
.resource-tabs :deep(.el-tabs__content) {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden auto;
  overscroll-behavior: contain;
}
.resource-body {
  display: grid;
  gap: var(--space-4);
  min-width: 0;
  padding: var(--space-4);
}
.resource-search {
  min-width: 0;
  --el-input-height: var(--control-height);
}
.resource-search :deep(.el-input__inner) {
  min-width: 0;
  font-size: var(--text-sm);
}
.resource-search :deep(.el-input__wrapper) {
  padding: 0 var(--space-3);
  background: var(--bg-secondary);
  border-radius: var(--radius-lg);
  box-shadow: none;
}
.resource-search :deep(.el-input__wrapper.is-focus) {
  box-shadow: 0 0 0 var(--border-width) var(--border-strong) inset;
}
.resource-search :deep(.el-input__prefix) {
  color: var(--text-tertiary);
}
.resource-table {
  width: 100%;
  min-width: 0;
  max-width: 100%;
  --el-table-border-color: var(--border-subtle);
  --el-table-header-text-color: var(--text-tertiary);
  --el-table-text-color: var(--text-primary);
  --el-table-header-bg-color: var(--bg-primary);
  --el-table-row-hover-bg-color: var(--bg-secondary);
}
.resource-table :deep(.el-table__cell) {
  height: var(--table-row-height);
  padding: var(--space-2) 0;
}
.resource-table :deep(th.el-table__cell) {
  height: var(--control-height);
  padding: var(--space-1) 0;
  color: var(--text-tertiary);
  background: var(--bg-primary);
  font-weight: 500;
}
.resource-table :deep(.el-table__inner-wrapper::before) {
  display: none;
}
.resource-table :deep(.cell) {
  min-width: 0;
  padding: 0 var(--space-1);
  line-height: 1.5;
  font-size: var(--text-xs);
}
.resource-table :deep(.resource-operation-cell .cell) {
  padding: 0;
}
.resource-table :deep(.el-table__empty-block) {
  min-height: calc(var(--table-row-height) * 3);
}
.resource-table :deep(.el-table__empty-text) {
  width: 100%;
  line-height: 1.5;
}
.resource-record {
  min-width: 0;
}
.resource-name {
  display: -webkit-box;
  overflow: hidden;
  min-width: 0;
  font-size: var(--text-sm);
  line-height: 1.55;
  overflow-wrap: anywhere;
  white-space: normal;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.resource-meta {
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-2);
  margin-top: var(--space-1);
  line-height: 1.5;
  white-space: normal;
}
.resource-meta time {
  overflow-wrap: anywhere;
}
.resource-file-name {
  align-items: flex-start;
  gap: var(--space-2);
}
.resource-file-name svg {
  margin-top: var(--space-1);
  color: var(--text-tertiary);
}
.resource-size {
  display: block;
  overflow-wrap: anywhere;
  font-variant-numeric: tabular-nums;
  line-height: var(--space-4);
}
.resource-unit {
  display: block;
  line-height: var(--space-4);
}
.resource-status {
  font-size: var(--text-xs);
  color: var(--text-secondary);
  white-space: nowrap;
}
.resource-status.running,
.resource-status.pending {
  color: var(--text-primary);
  font-weight: 500;
}
.resource-status.failed,
.resource-status.expired {
  color: var(--error);
}
.resource-status.cancelled {
  color: var(--text-tertiary);
}
.resource-loading {
  display: grid;
  gap: var(--space-3);
  color: var(--text-secondary);
  font-size: var(--text-xs);
}
.resource-loading :deep(.el-skeleton) {
  display: grid;
  gap: var(--space-2);
  --el-skeleton-color: var(--bg-tertiary);
  --el-skeleton-to-color: var(--bg-secondary);
}
.resource-loading :deep(.el-skeleton__item) {
  height: var(--table-row-height);
  border-radius: var(--radius-md);
}
.resource-empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  min-height: calc(var(--table-row-height) * 3);
  padding: var(--space-4) 0;
  color: var(--text-tertiary);
}
.resource-empty-state > svg {
  width: var(--icon-size-lg);
  height: var(--icon-size-lg);
}
.resource-empty {
  margin: 0;
  text-align: center;
  color: var(--text-tertiary);
  font-size: var(--text-xs);
}
.resource-note {
  margin: 0;
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.resource-usage {
  display: grid;
  margin: 0;
  font-size: var(--text-sm);
}
.resource-usage > div {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  align-items: baseline;
  gap: var(--space-3);
  padding: var(--space-4) 0;
  border-bottom: var(--border-width) solid var(--border-subtle);
}
.resource-usage dt {
  color: var(--text-secondary);
}
.resource-usage dd {
  margin: 0;
  text-align: right;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.resource-error {
  flex-shrink: 0;
  box-sizing: border-box;
  width: auto;
  margin: 0 var(--space-4) var(--space-3);
}
.resource-confirm {
  flex-shrink: 0;
  min-width: 0;
  max-height: 45%;
  padding: var(--space-4);
  overflow: auto;
  border-top: var(--border-width) solid var(--border-subtle);
}
.resource-confirm :deep(.el-alert--warning) {
  color: var(--text-primary);
  background: var(--bg-secondary);
}
.resource-confirm-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.resource-confirm-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}
:deep(.el-alert) {
  padding: var(--space-3);
  border-radius: var(--radius-md);
}
:deep(.el-alert__content) {
  min-width: 0;
}
:deep(.el-alert__title) {
  font-size: var(--text-xs);
  line-height: 1.5;
  overflow-wrap: anywhere;
}
:deep(.el-alert__description) {
  margin-top: var(--space-2);
}
:deep(.el-button:focus-visible),
:deep(.el-tabs__item:focus-visible) {
  outline: var(--focus-width) solid var(--accent-primary);
  outline-offset: calc(-1 * var(--focus-width));
}
@container (max-width: 320px) {
  .resource-header {
    gap: var(--space-2);
    padding: var(--space-3);
  }
  .resource-body,
  .resource-confirm {
    padding: var(--space-3);
  }
  .resource-tabs :deep(.el-tabs__header) {
    padding: 0 var(--space-3);
  }
  .resource-error {
    margin-right: var(--space-3);
    margin-left: var(--space-3);
  }
  .resource-file-name {
    gap: var(--space-1);
  }
}
</style>
