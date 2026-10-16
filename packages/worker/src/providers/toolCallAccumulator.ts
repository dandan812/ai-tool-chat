import type { ToolCall } from '../types'

/** Tool arguments arrive as JSON fragments; nothing is executable until the turn finishes. */
export class ToolCallAccumulator {
  private readonly calls = new Map<number, { id: string; name: string; arguments: string }>()
  private bytes = 0

  get size(): number {
    return this.calls.size
  }

  append(input: unknown): void {
    if (!Array.isArray(input)) throw new Error('Invalid tool calls')
    for (const value of input) {
      if (
        !value ||
        typeof value !== 'object' ||
        !Number.isInteger(value.index) ||
        value.index < 0 ||
        value.index >= 2
      )
        throw new Error('Tool call limit exceeded')
      if (value.type !== undefined && value.type !== 'function')
        throw new Error('Unsupported tool type')
      const call = this.calls.get(value.index) ?? { id: '', name: '', arguments: '' }
      for (const [key, fragment] of [
        ['id', value.id],
        ['name', value.function?.name],
        ['arguments', value.function?.arguments]
      ] as const) {
        if (fragment === undefined || fragment === null) continue
        if (typeof fragment !== 'string') throw new Error('Invalid tool fragment')
        this.bytes += new TextEncoder().encode(fragment).length
        if (this.bytes > 8000) throw new Error('Tool arguments exceed limit')
        call[key] += fragment
      }
      this.calls.set(value.index, call)
    }
  }

  finish(): ToolCall[] {
    const ids = new Set<string>()
    return [...this.calls.entries()]
      .sort(([a], [b]) => a - b)
      .map(([index, call], position) => {
        if (
          index !== position ||
          !/^[A-Za-z0-9_-]{1,128}$/.test(call.id) ||
          !/^[a-z_]{1,64}$/.test(call.name) ||
          ids.has(call.id)
        )
          throw new Error('Invalid tool identity')
        ids.add(call.id)
        const args: unknown = JSON.parse(call.arguments)
        if (!args || typeof args !== 'object' || Array.isArray(args))
          throw new Error('Invalid tool arguments')
        return { id: call.id, name: call.name, arguments: args as Record<string, unknown> }
      })
  }
}
