import { createApp, h, nextTick, ref, type App } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountUser } from '../api/account'
import { useAccountSession } from '../features/accounts/useAccountSession'
import AccountGate from './AccountGate.vue'

vi.mock('../features/accounts/useAccountSession', () => ({ useAccountSession: vi.fn() }))
vi.mock('element-plus/es/components/alert/style/css', () => ({}))
vi.mock('element-plus/es/components/button/style/css', () => ({}))
vi.mock('element-plus/es/components/form/style/css', () => ({}))
vi.mock('element-plus/es/components/form-item/style/css', () => ({}))
vi.mock('element-plus/es/components/input/style/css', () => ({}))

let app: App | undefined
let session: ReturnType<typeof createSession>

function createSession() {
  return {
    ready: ref(false),
    user: ref<AccountUser | null>(null),
    username: ref(''),
    password: ref(''),
    registering: ref(false),
    registrationEnabled: ref(false),
    guestEnabled: ref(false),
    pending: ref(false),
    error: ref(''),
    loadFailed: ref(false),
    submit: vi.fn(async () => {}),
    retry: vi.fn(async () => {})
  }
}
beforeEach(() => {
  session = createSession()
  vi.mocked(useAccountSession).mockReturnValue(session)
})
afterEach(() => {
  app?.unmount()
  app = undefined
  document.body.innerHTML = ''
})
async function settle() {
  await nextTick()
  await nextTick()
}
async function mount() {
  const root = document.createElement('div')
  document.body.append(root)
  app = createApp({
    render: () =>
      h(AccountGate, null, {
        default: () => h('section', { 'aria-label': '账户内容' }, '已登录')
      })
  })
  app.mount(root)
  await settle()
  return root
}
function button(root: HTMLElement, label: string) {
  const result = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(
    (element) => element.textContent?.trim() === label
  )
  expect(result, `button "${label}"`).toBeDefined()
  return result!
}

describe('AccountGate', () => {
  it('offers retry instead of credentials when account discovery fails', async () => {
    session.ready.value = true
    session.loadFailed.value = true
    session.error.value = '无法连接账户服务'
    const root = await mount()
    expect(root.querySelector('form')).toBeNull()
    expect(root.textContent).toContain('暂时无法连接')
    button(root, '重试').click()
    expect(session.retry).toHaveBeenCalledOnce()
  })

  it('waits for the account to be ready before exposing authenticated slot content', async () => {
    session.user.value = { id: 'alice', username: 'Alice' }
    const root = await mount()
    expect(root.querySelector('[aria-label="账户内容"]')).toBeNull()
    expect(root.querySelector('main')?.getAttribute('aria-busy')).toBe('true')
    expect(root.querySelector('[role="status"]')?.getAttribute('aria-label')).toBe('正在连接账户')
    expect(root.querySelector('form')).toBeNull()

    session.ready.value = true
    await settle()
    expect(root.querySelector('[aria-label="账户内容"]')?.textContent).toBe('已登录')
    expect(root.querySelector('main')).toBeNull()
  })

  it('binds login credentials, retains native input constraints, and submits through the session', async () => {
    session.ready.value = true
    const root = await mount()
    const username = root.querySelector<HTMLInputElement>('#username')!
    const password = root.querySelector<HTMLInputElement>('#password')!
    expect(root.querySelector('label[for="username"]')?.textContent).toBe('用户名')
    expect(root.querySelector('label[for="password"]')?.textContent).toBe('密码')
    expect(username.required).toBe(true)
    expect(username.minLength).toBe(3)
    expect(username.maxLength).toBe(64)
    expect(username.autocomplete).toBe('username')
    expect(password.required).toBe(true)
    expect(password.maxLength).toBe(128)
    expect(password.autocomplete).toBe('current-password')
    expect(password.hasAttribute('minlength')).toBe(false)
    username.value = 'Alice'
    username.dispatchEvent(new Event('input', { bubbles: true }))
    password.value = 'my-current-password'
    password.dispatchEvent(new Event('input', { bubbles: true }))
    await settle()
    expect(session.username.value).toBe('Alice')
    expect(session.password.value).toBe('my-current-password')
    expect(button(root, '登录工作台').type).toBe('submit')
    const submission = new Event('submit', { bubbles: true, cancelable: true })
    root.querySelector('form')!.dispatchEvent(submission)
    expect(submission.defaultPrevented).toBe(true)
    expect(session.submit).toHaveBeenCalledOnce()
  })

  it('switches registration without losing credentials and protects controls during submission', async () => {
    session.ready.value = true
    session.registrationEnabled.value = true
    session.username.value = 'Alice'
    session.password.value = 'a-long-enough-password'
    session.error.value = '登录失败'
    const root = await mount()
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('登录失败')
    button(root, '创建新账户').click()
    await settle()
    const password = root.querySelector<HTMLInputElement>('#password')!
    expect(session.registering.value).toBe(true)
    expect(session.error.value).toBe('')
    expect(session.username.value).toBe('Alice')
    expect(session.password.value).toBe('a-long-enough-password')
    expect(password.autocomplete).toBe('new-password')
    expect(password.minLength).toBe(12)
    expect(password.getAttribute('aria-describedby')).toBe('account-password-hint')
    expect(root.querySelector('#account-password-hint')?.textContent).toContain('至少 12 个字符')
    root.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true }))
    expect(session.submit).toHaveBeenCalledOnce()
    session.pending.value = true
    await settle()
    expect(root.querySelector<HTMLInputElement>('#username')!.disabled).toBe(true)
    expect(password.disabled).toBe(true)
    expect(button(root, '处理中…').disabled).toBe(true)
    expect(button(root, '已有账户，去登录').disabled).toBe(true)
    button(root, '处理中…').click()
    button(root, '已有账户，去登录').click()
    expect(session.submit).toHaveBeenCalledOnce()
    expect(session.registering.value).toBe(true)

    session.pending.value = false
    await settle()
    button(root, '已有账户，去登录').click()
    await settle()
    expect(password.autocomplete).toBe('current-password')
    expect(password.hasAttribute('minlength')).toBe(false)
    expect(password.hasAttribute('aria-describedby')).toBe(false)
    expect(root.querySelector('#account-password-hint')).toBeNull()
  })

  it('respects disabled registration and renders service errors as text', async () => {
    session.ready.value = true
    session.error.value = '<img src=x onerror=alert(1)>'
    const root = await mount()
    expect(root.querySelector('.account-switch')).toBeNull()
    expect(root.textContent).toContain('当前不开放注册，请联系管理员开通。')
    expect(root.querySelector('[role="alert"]')?.textContent).toContain(session.error.value)
    expect(root.querySelector('img')).toBeNull()
  })

  it('retries failed guest startup without requesting credentials', async () => {
    session.ready.value = true
    session.guestEnabled.value = true
    session.error.value = '访客容量已满'
    session.retry.mockImplementation(async () => {
      session.ready.value = false
    })
    const root = await mount()
    expect(root.querySelector('form, input')).toBeNull()
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('访客容量已满')
    button(root, '重试').click()
    await settle()
    expect(session.retry).toHaveBeenCalledOnce()
    expect(root.querySelector('[role="status"]')).not.toBeNull()
    expect(root.querySelector('button, input')).toBeNull()
  })
})
