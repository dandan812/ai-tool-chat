import { onMounted, onScopeDispose, ref } from 'vue'
import { apiJSON, notifyAccountChanged } from '../../api/account'
import type { Task } from '../../types/task'

interface UserFile { fileId: string; fileName?: string; bytes: number; status: string }
interface Usage { chargedTokens: number; dailyTokenBudget: number; activeTasks: number }

export function useWorkspace() {
  const tasks = ref<Task[]>([])
  const files = ref<UserFile[]>([])
  const usage = ref<Usage | null>(null)
  const username = ref('')
  const guest = ref(false)
  const pending = ref(false)
  const error = ref('')
  const confirmDelete = ref('')
  const controller = new AbortController()
  const operations = ref(new Set<string>())
  let activeRefresh: Promise<void> | undefined
  let refreshQueued = false

  function refresh(): Promise<void> {
    if (controller.signal.aborted) return Promise.resolve()
    if (activeRefresh) {
      refreshQueued = true
      return activeRefresh
    }
    pending.value = true
    activeRefresh = loadRecords().finally(() => {
      pending.value = false
      activeRefresh = undefined
    })
    return activeRefresh
  }
  async function loadRecords() {
    // 变更期间已有刷新时，丢弃旧快照并补读一次，而不是吞掉变更后的刷新。
    do {
      refreshQueued = false
      error.value = ''
      const init = { signal: controller.signal }
      try {
        const [taskList, fileList, currentUsage, me] = await Promise.all([
          apiJSON<{ tasks: Task[] }>('/tasks', init),
          apiJSON<{ files: UserFile[] }>('/auth/files', init),
          apiJSON<Usage>('/auth/usage', init),
          apiJSON<{ user: { username: string; guest?: boolean } }>('/auth/me', init),
        ])
        if (controller.signal.aborted) return
        if (refreshQueued) continue
        tasks.value = taskList.tasks
        files.value = fileList.files
        usage.value = currentUsage
        guest.value = me.user.guest ?? false
        username.value = guest.value ? '访客' : me.user.username
      } catch (caught) {
        if (!controller.signal.aborted && !refreshQueued) error.value = caught instanceof Error ? caught.message : '加载失败'
      }
    } while (refreshQueued && !controller.signal.aborted)
  }
  async function mutate(key: string, action: () => Promise<void>) {
    if (operations.value.has(key) || controller.signal.aborted) return
    operations.value.add(key)
    error.value = ''
    try { await action() }
    catch (caught) {
      if (!controller.signal.aborted) error.value = caught instanceof Error ? caught.message : '操作失败'
    } finally { operations.value.delete(key) }
  }
  async function logout() {
    await mutate('logout', async () => {
      await apiJSON('/auth/logout', { method: 'POST', body: '{}', signal: controller.signal })
      notifyAccountChanged()
      window.location.reload()
    })
  }
  async function cancel(id: string) {
    await mutate('task:' + id, async () => {
      await apiJSON('/tasks/' + encodeURIComponent(id) + '/cancel', { method: 'POST', body: '{}', signal: controller.signal })
      await refresh()
    })
  }
  async function removeFile(id: string) {
    if (confirmDelete.value !== id) { confirmDelete.value = id; return }
    await mutate('file:' + id, async () => {
      await apiJSON('/upload/delete?fileId=' + encodeURIComponent(id), { method: 'POST', body: '{}', signal: controller.signal })
      confirmDelete.value = ''
      await refresh()
    })
  }
  onMounted(() => { void refresh() })
  onScopeDispose(() => controller.abort())
  return { tasks, files, usage, username, guest, pending, error, confirmDelete, operations, refresh, logout, cancel, removeFile }
}
