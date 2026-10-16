/** JS-controlled geometry reads the same CSS tokens as the layout. */
export function designPixels(token: string): number {
  const value = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue(token)
  )
  return Number.isFinite(value) ? value : 0
}
