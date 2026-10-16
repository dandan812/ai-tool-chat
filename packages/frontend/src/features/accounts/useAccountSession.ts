import { onMounted, onUnmounted, ref } from 'vue'
import {
  apiJSON,
  getAccountRevision,
  notifyAccountChanged,
  setStorageAccount,
  type AccountUser
} from '../../api/account'

export function useAccountSession() {
  const ready = ref(false)
  const user = ref<AccountUser | null>(null)
  const username = ref('')
  const password = ref('')
  const registering = ref(false)
  const registrationEnabled = ref(false)
  const guestEnabled = ref(false)
  const pending = ref(false)
  const error = ref('')
  const loadFailed = ref(false)
  let disposed = false
  let loadGeneration = 0

  function expired() {
    user.value = null
    setStorageAccount(null)
    error.value = guestEnabled.value ? '' : '账户已变化或登录过期，请重新登录。'
    if (guestEnabled.value) {
      ready.value = false
      // Pinia also contains account-owned messages and attachments; recreate it.
      window.location.reload()
    }
  }
  function changed(event: StorageEvent) {
    if (event.key === 'ait_account_changed') expired()
  }
  async function load() {
    const generation = ++loadGeneration
    const revision = getAccountRevision()
    ready.value = false
    error.value = ''
    loadFailed.value = false
    try {
      let result = await apiJSON<{
        user: AccountUser | null
        registrationEnabled?: boolean
        guestEnabled?: boolean
      }>('/auth/me')
      if (disposed || generation !== loadGeneration || getAccountRevision() !== revision) return
      registrationEnabled.value = result.registrationEnabled ?? false
      guestEnabled.value = result.guestEnabled ?? false
      if (!result.user && guestEnabled.value) {
        result = await apiJSON<{ user: AccountUser }>('/auth/guest', { method: 'POST', body: '{}' })
        if (disposed || generation !== loadGeneration || getAccountRevision() !== revision) return
      }
      setStorageAccount(result.user?.id ?? null)
      user.value = result.user
    } catch (caught) {
      if (!disposed && generation === loadGeneration && getAccountRevision() === revision) {
        loadFailed.value = true
        error.value =
          caught instanceof TypeError
            ? '无法连接账户服务，请确认服务可用后重试。'
            : caught instanceof Error
              ? caught.message
              : '账户服务暂时不可用'
      }
    } finally {
      if (!disposed && generation === loadGeneration) ready.value = true
    }
  }
  async function submit() {
    if (pending.value) return
    pending.value = true
    error.value = ''
    try {
      await apiJSON('/auth/' + (registering.value ? 'register' : 'login'), {
        method: 'POST',
        body: JSON.stringify({ username: username.value, password: password.value })
      })
      password.value = ''
      notifyAccountChanged()
      // 重载释放上一个账户的 Store、定时器和附件引用。
      window.location.reload()
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : '登录失败'
    } finally {
      pending.value = false
    }
  }
  onMounted(() => {
    window.addEventListener('account-expired', expired)
    window.addEventListener('storage', changed)
    void load()
  })
  onUnmounted(() => {
    disposed = true
    window.removeEventListener('account-expired', expired)
    window.removeEventListener('storage', changed)
  })
  return {
    ready,
    user,
    username,
    password,
    registering,
    registrationEnabled,
    guestEnabled,
    pending,
    error,
    loadFailed,
    submit,
    retry: load
  }
}
