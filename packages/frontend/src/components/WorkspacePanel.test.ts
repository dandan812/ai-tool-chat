import { createApp, h, nextTick, onMounted, ref, type App } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Task } from '../types/task'
import { useWorkspace } from '../features/workspace/useWorkspace'
import WorkspacePanel from './WorkspacePanel.vue'
import { readFileSync } from 'node:fs'

// Vitest disables dependency CSS; load the real geometry tokens for jsdom.
const tokens = readFileSync('src/styles/tokens.css', 'utf8')

vi.mock('../features/workspace/useWorkspace', () => ({ useWorkspace: vi.fn() }))
// Keep real components; their external CSS entrypoints require a browser CSS loader.
vi.mock('element-plus/es/components/alert/style/css', () => ({}))
vi.mock('element-plus/es/components/button/style/css', () => ({}))
vi.mock('element-plus/es/components/input/style/css', () => ({}))
vi.mock('element-plus/es/components/skeleton/style/css', () => ({}))
vi.mock('element-plus/es/components/skeleton-item/style/css', () => ({}))
vi.mock('element-plus/es/components/table/style/css', () => ({}))
vi.mock('element-plus/es/components/table-column/style/css', () => ({}))
vi.mock('element-plus/es/components/tabs/style/css', () => ({}))
vi.mock('element-plus/es/components/tab-pane/style/css', () => ({}))
vi.mock('element-plus/es/components/tooltip/style/css', () => ({}))

type PanelProps = {
  open: boolean
  viewing: boolean
  view?: 'tasks' | 'files' | 'usage'
  modal?: boolean
}
type Workspace = ReturnType<typeof useWorkspace>
let app: App | undefined
let workspace: ReturnType<typeof createWorkspace>
let tokenStyle: HTMLStyleElement

function task(id: string, status: Task['status']): Task {
  return {
    id,
    status,
    type: 'chat',
    userMessage: `问题 ${id}`,
    steps: [],
    createdAt: Date.UTC(2026, 9, 10, 8),
    updatedAt: Date.UTC(2026, 9, 10, 8)
  }
}
function createWorkspace() {
  return {
    tasks: ref<Task[]>([]),
    files: ref<Workspace['files']['value']>([]),
    usage: ref<Workspace['usage']['value']>(null),
    username: ref('Alice'),
    guest: ref(false),
    pending: ref(false),
    error: ref(''),
    confirmDelete: ref(''),
    operations: ref(new Set<string>()),
    refresh: vi.fn(async () => {}),
    logout: vi.fn(async () => {}),
    cancel: vi.fn<(id: string) => Promise<void>>(async () => {}),
    removeFile: vi.fn(async (id: string) => {
      if (workspace.confirmDelete.value !== id) {
        workspace.confirmDelete.value = id
        return
      }
      workspace.files.value = workspace.files.value.filter((file) => file.fileId !== id)
      workspace.confirmDelete.value = ''
    })
  }
}
beforeEach(() => {
  tokenStyle = document.createElement('style')
  tokenStyle.textContent = tokens
  document.head.append(tokenStyle)
  workspace = createWorkspace()
  vi.mocked(useWorkspace).mockImplementation(() => {
    // Match the real composable's initial load to detect duplicate component refreshes.
    onMounted(() => {
      void workspace.refresh()
    })
    return workspace
  })
})
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.innerHTML = ''
  tokenStyle.remove()
  vi.restoreAllMocks()
})

async function settle() {
  await nextTick()
  await nextTick()
}
async function mount(options: Partial<PanelProps> = {}) {
  const props = ref<PanelProps>({ open: true, viewing: false, view: 'tasks', ...options })
  const events: unknown[][] = []
  const root = document.createElement('div')
  document.body.append(root)
  app = createApp({
    setup: () => () =>
      h(WorkspacePanel, {
        ...props.value,
        onUpdateOpen: (open: boolean) => events.push(['updateOpen', open]),
        onUpdateView: (view: PanelProps['view']) => events.push(['updateView', view]),
        onOpenTask: (id: string) => events.push(['openTask', id]),
        onStopViewing: () => events.push(['stopViewing'])
      })
  })
  app.mount(root)
  await settle()
  return { root, props, events }
}
function button(root: HTMLElement, label: string) {
  const result = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(
    (element) =>
      element.getAttribute('aria-label') === label || element.textContent?.trim() === label
  )
  expect(result, `button "${label}"`).toBeDefined()
  return result!
}

describe('WorkspacePanel', () => {
  it('keeps selected tabs and updateView compatible with the parent view prop', async () => {
    const { root, props, events } = await mount()
    expect(events).toEqual([])
    root.querySelector<HTMLElement>('#tab-files')!.click()
    await settle()
    expect(events).toEqual([['updateView', 'files']])
    expect(root.querySelector('.resource-body')?.getAttribute('aria-label')).toBe('文件')
    props.value.view = 'usage'
    await settle()
    expect(events[events.length - 1]).toEqual(['updateView', 'usage'])
    expect(root.querySelector('[role="tab"][aria-selected="true"]')?.id).toBe('tab-usage')
    props.value.view = undefined
    await settle()
    expect(events[events.length - 1]).toEqual(['updateView', 'tasks'])
    expect(root.querySelector('[role="tab"][aria-selected="true"]')?.id).toBe('tab-tasks')
    expect(workspace.refresh).toHaveBeenCalledTimes(1)
  })

  it.each([true, false])(
    'loads once on mount with open=%s and refreshes on subsequent openings',
    async (open) => {
      const { root, props } = await mount({ open })
      expect(root.querySelector('aside')).not.toBeNull()
      expect(root.querySelector('details, summary')).toBeNull()
      expect(workspace.refresh).toHaveBeenCalledTimes(1)
      if (open) {
        props.value.open = false
        await settle()
      }
      expect(root.querySelector<HTMLElement>('aside')?.style.display).toBe('none')
      props.value.open = true
      await settle()
      expect(workspace.refresh).toHaveBeenCalledTimes(2)
      props.value.view = 'files'
      await settle()
      expect(workspace.refresh).toHaveBeenCalledTimes(2)
      expect(root.querySelector('[role="tab"][aria-selected="true"]')?.id).toBe('tab-files')
    }
  )

  it('restores the actual task, cancels only active tasks, and blocks repeated cancellation while busy', async () => {
    workspace.tasks.value = [
      task('running', 'running'),
      task('pending', 'pending'),
      task('done', 'completed')
    ]
    const { root, events } = await mount()
    button(root, '打开 / 恢复任务：问题 done').click()
    expect(events).toEqual([
      ['updateOpen', false],
      ['openTask', 'done']
    ])
    expect(root.querySelectorAll('button[aria-label^="取消后台任务"]').length).toBe(2)

    let finish!: () => void
    const cancellation = new Promise<void>((resolve) => {
      finish = resolve
    })
    workspace.cancel.mockImplementation(async (id) => {
      workspace.operations.value.add(`task:${id}`)
      await cancellation
      workspace.tasks.value.find((record) => record.id === id)!.status = 'cancelled'
      workspace.operations.value.delete(`task:${id}`)
    })
    button(root, '取消后台任务：问题 running').click()
    await settle()
    expect(workspace.cancel).toHaveBeenCalledWith('running')
    expect(button(root, '取消后台任务：问题 running').disabled).toBe(true)
    expect(button(root, '打开 / 恢复任务：问题 running').disabled).toBe(true)
    button(root, '取消后台任务：问题 running').click()
    expect(workspace.cancel).toHaveBeenCalledTimes(1)
    finish()
    await settle()
    expect(root.textContent).toContain('已取消')
    expect(root.querySelectorAll('button[aria-label^="取消后台任务"]').length).toBe(1)
    expect(button(root, '打开 / 恢复任务：问题 running').disabled).toBe(false)
  })

  it('requires a second deletion action, keeps the chosen file, and returns keyboard focus', async () => {
    workspace.files.value = [
      {
        fileId: 'first',
        fileName: '<img src=x onerror=alert(1)>.txt',
        bytes: 1024,
        status: 'complete'
      },
      { fileId: 'second', fileName: 'notes.txt', bytes: 2048, status: 'expired' }
    ]
    const { root } = await mount({ view: 'files' })
    const deleteButton = button(root, '删除文件：<img src=x onerror=alert(1)>.txt')
    deleteButton.click()
    await settle()
    expect(workspace.removeFile).toHaveBeenCalledWith('first')
    expect(workspace.files.value).toHaveLength(2)
    expect(root.querySelector('img')).toBeNull()
    expect(root.querySelector('[aria-label="删除文件二次确认"]')?.textContent).toContain(
      '<img src=x onerror=alert(1)>.txt'
    )
    expect(deleteButton.disabled).toBe(true)
    expect(document.activeElement).toBe(button(root, '确认删除'))
    button(root, '保留').click()
    await settle()
    expect(workspace.confirmDelete.value).toBe('')
    expect(workspace.files.value).toHaveLength(2)
    expect(workspace.removeFile).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(deleteButton)

    deleteButton.click()
    await settle()
    button(root, '确认删除').click()
    await settle()
    expect(workspace.removeFile).toHaveBeenCalledTimes(3)
    expect(workspace.files.value.map((file) => file.fileId)).toEqual(['second'])
    expect(root.querySelector('[aria-label="删除文件二次确认"]')).toBeNull()
  })

  it('retains file confirmation after a failed deletion and disables both actions while it is in flight', async () => {
    workspace.files.value = [
      { fileId: 'file', fileName: 'notes.txt', bytes: 1024, status: 'complete' }
    ]
    let finish!: () => void
    const deletion = new Promise<void>((resolve) => {
      finish = resolve
    })
    workspace.removeFile.mockImplementation(async (id) => {
      if (workspace.confirmDelete.value !== id) {
        workspace.confirmDelete.value = id
        return
      }
      workspace.operations.value.add(`file:${id}`)
      await deletion
      workspace.error.value = '删除失败，请重试'
      workspace.operations.value.delete(`file:${id}`)
    })
    const { root } = await mount({ view: 'files' })
    button(root, '删除文件：notes.txt').click()
    await settle()
    button(root, '确认删除').click()
    await settle()
    expect(button(root, '确认删除').disabled).toBe(true)
    expect(button(root, '保留').disabled).toBe(true)
    button(root, '确认删除').click()
    expect(workspace.removeFile).toHaveBeenCalledTimes(2)
    finish()
    await settle()
    expect(root.querySelector('.resource-error[role="alert"]')?.textContent).toContain(
      '删除失败，请重试'
    )
    expect(workspace.confirmDelete.value).toBe('file')
    expect(workspace.files.value).toHaveLength(1)
    expect(button(root, '确认删除').disabled).toBe(false)
  })

  it.each([true, false])(
    'loops focus around dynamic confirmation only for modal=%s',
    async (modal) => {
      workspace.files.value = [
        { fileId: 'file', fileName: 'notes.txt', bytes: 1024, status: 'complete' }
      ]
      const { root } = await mount({ view: 'files', modal })
      // jsdom has no layout; expose the mounted controls as visible.
      vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockReturnValue(root)
      button(root, '删除文件：notes.txt').click()
      await settle()
      const first = button(root, '刷新记录')
      const last = button(root, '保留')
      last.focus()
      const forward = new KeyboardEvent('keydown', {
        key: 'Tab',
        bubbles: true,
        cancelable: true
      })
      last.dispatchEvent(forward)
      expect(forward.defaultPrevented).toBe(modal)
      expect(document.activeElement).toBe(modal ? first : last)
      first.focus()
      const backward = new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: true,
        bubbles: true,
        cancelable: true
      })
      first.dispatchEvent(backward)
      expect(backward.defaultPrevented).toBe(modal)
      expect(document.activeElement).toBe(modal ? last : first)
    }
  )

  it.each(['tasks', 'files', 'usage'] as const)(
    'distinguishes loading, empty, and errors for %s and provides retry',
    async (view) => {
      workspace.pending.value = true
      const { root } = await mount({ view })
      expect(root.querySelector('.resource-loading .el-skeleton')).not.toBeNull()
      expect(root.querySelector('.resource-body')?.getAttribute('aria-busy')).toBe('true')
      expect(root.querySelector('.resource-empty, .resource-table')).toBeNull()
      expect(button(root, '刷新记录').disabled).toBe(true)
      workspace.pending.value = false
      await settle()
      expect(root.querySelector('.resource-loading')).toBeNull()
      expect(root.querySelector('.resource-empty')?.textContent).toBe(
        view === 'tasks' ? '暂无任务' : view === 'files' ? '暂无文件' : '暂无用量记录'
      )
      workspace.error.value = '加载失败'
      await settle()
      expect(root.querySelector('.resource-error[role="alert"]')?.textContent).toContain('加载失败')
      expect(root.querySelector('.resource-empty')?.textContent).toBe(
        view === 'usage' ? '用量暂不可用' : '记录暂不可用'
      )
      button(root, '重试').click()
      expect(workspace.refresh).toHaveBeenCalledTimes(2)
    }
  )

  it('filters actual records, trims search whitespace, and navigates selected tabs without intercepting input keys', async () => {
    workspace.tasks.value = [task('Alpha', 'completed')]
    workspace.files.value = [
      { fileId: 'file', fileName: 'alpha.txt', bytes: 1024, status: 'complete' }
    ]
    const { root } = await mount()
    const input = root.querySelector<HTMLInputElement>('input')!
    input.value = 'missing'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()
    expect(root.querySelector('.resource-empty')?.textContent).toBe('没有匹配的任务')
    input.value = '  ALPHA  '
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()
    expect(root.querySelector('.resource-empty')).toBeNull()
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    expect(root.querySelector('[role="tab"][aria-selected="true"]')?.id).toBe('tab-tasks')

    const key = async (value: string) => {
      root
        .querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')!
        .dispatchEvent(
          new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true })
        )
      await settle()
      const selected = root.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')!
      expect(document.activeElement).toBe(selected)
      expect(selected.tabIndex).toBe(0)
      expect(root.querySelectorAll('[role="tab"][tabindex="0"]')).toHaveLength(1)
      return selected.id
    }
    expect(await key('ArrowRight')).toBe('tab-files')
    expect(root.querySelector('.resource-table')?.textContent).toContain('alpha.txt')
    expect(await key('End')).toBe('tab-usage')
    expect(await key('Home')).toBe('tab-tasks')
    expect(await key('ArrowLeft')).toBe('tab-usage')
  })

  it('preserves usage, stop-viewing, logout, and close controls, and hides logout for guests', async () => {
    workspace.usage.value = { chargedTokens: 1234, dailyTokenBudget: 5000, activeTasks: 2 }
    const { root, props, events } = await mount({ view: 'usage', viewing: true })
    expect(root.querySelector('.resource-usage')?.textContent).toContain('1,234 token')
    expect(root.querySelector('.resource-usage')?.textContent).toContain('5,000 token')
    expect(root.querySelector('.resource-note')?.textContent).toContain('不等于供应商账单')
    button(root, '停止查看').click()
    button(root, '关闭面板').click()
    expect(events).toEqual([['stopViewing'], ['updateOpen', false]])
    button(root, '退出账户').click()
    expect(workspace.logout).toHaveBeenCalledTimes(1)
    workspace.operations.value.add('logout')
    await settle()
    expect(button(root, '退出账户').disabled).toBe(true)
    button(root, '退出账户').click()
    expect(workspace.logout).toHaveBeenCalledTimes(1)
    workspace.guest.value = true
    props.value.viewing = false
    await settle()
    expect(root.querySelector('button[aria-label="退出账户"]')).toBeNull()
    expect(root.querySelector('button[aria-label="停止查看"]')).toBeNull()
  })

  it.each([256, 336])(
    'fits the real file table columns within %s px of available width',
    async (width) => {
      // jsdom has no CSS layout; supply only the measured table width to ElTable's real layout.
      vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (
        this: HTMLElement
      ) {
        return this.classList.contains('resource-table') ? width : 0
      })
      workspace.files.value = [
        { fileId: 'file', fileName: 'a'.repeat(200) + '.txt', bytes: 1024, status: 'complete' }
      ]
      const { root } = await mount({ view: 'files' })
      await vi.waitFor(() => {
        const columns = Array.from(root.querySelectorAll('.el-table__body colgroup col'))
        expect(columns).toHaveLength(4)
        expect(
          columns.reduce((total, column) => total + Number(column.getAttribute('width')), 0)
        ).toBe(width)
      })
      expect(root.querySelector('.resource-file-name .resource-name')?.textContent).toBe(
        'a'.repeat(200) + '.txt'
      )
      expect(root.querySelector('.resource-file-name .resource-name')?.getAttribute('title')).toBe(
        'a'.repeat(200) + '.txt'
      )
      expect(button(root, '删除文件：' + 'a'.repeat(200) + '.txt').disabled).toBe(false)
    }
  )
})
