import { describe, expect, it, vi } from 'vitest'
import { TaskManager } from '../core/taskManager'
import { createMockEnv } from '../test/mocks'
import type { ChatRequest } from '../types'

vi.mock('../skills', () => ({
  selectSkill: () => ({
    skill: {
      name: 'mock-text',
      type: 'text',
      description: 'mock skill',
      async *execute() {
        yield { type: 'content', content: 'mock answer' }
        yield { type: 'complete' }
      }
    },
    model: 'mock-model',
    label: '调用 Mock 模型',
    description: '模拟技能执行',
    toolingMode: 'disabled'
  })
}))

describe('集成测试', () => {
  it('应该能创建并执行一条聊天任务', async () => {
    const env = createMockEnv()
    const taskManager = new TaskManager(env)
    const request: ChatRequest = {
      messages: [{ role: 'user', content: 'Hello AI' }]
    }

    const task = taskManager.createTask(request)
    const chunks: string[] = []

    for await (const event of taskManager.executeTask(task.id, request)) {
      if (event.type === 'content') {
        chunks.push((event.data as { content: string }).content)
      }
    }

    expect(chunks.join('')).toContain('mock answer')
    expect(taskManager.getTask(task.id)?.status).toBe('completed')
  })
})
