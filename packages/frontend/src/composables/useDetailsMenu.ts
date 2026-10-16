import { onMounted, onScopeDispose, ref } from 'vue'

export function useDetailsMenu() {
  const menu = ref<HTMLDetailsElement | null>(null)

  function close(restoreFocus = false) {
    if (!menu.value?.open) return
    menu.value.open = false
    if (restoreFocus) menu.value.querySelector('summary')?.focus()
  }

  function dismissOutside(event: Event) {
    if (event.target instanceof Node && !menu.value?.contains(event.target)) close()
  }

  function keydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && menu.value?.open) {
      event.preventDefault()
      event.stopPropagation()
      close(true)
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || !menu.value) return
    const items = Array.from(
      menu.value.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')
    )
    if (!items.length) return
    event.preventDefault()
    menu.value.open = true
    const current = items.indexOf(document.activeElement as HTMLButtonElement)
    const index =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : event.key === 'ArrowUp'
            ? current <= 0
              ? items.length - 1
              : current - 1
            : (current + 1) % items.length
    items[index]?.focus()
  }

  onMounted(() => {
    document.addEventListener('pointerdown', dismissOutside)
    document.addEventListener('focusin', dismissOutside)
  })
  onScopeDispose(() => {
    document.removeEventListener('pointerdown', dismissOutside)
    document.removeEventListener('focusin', dismissOutside)
  })
  return { menu, close, keydown }
}
