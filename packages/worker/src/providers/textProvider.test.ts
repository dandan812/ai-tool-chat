import { describe, expect, it } from 'vitest'
import type { SkillContext, SkillInput } from '../types'
import { DEFAULT_QWEN_TEXT_MODEL } from '../model/textModel'
import { hasTextProviderCredentials, resolveTextProvider } from './textProvider'
import { selectSkill } from '../skills'
import { selectFileTextExecutor } from '../skills/fileSkillSupport'

function createContext(env: Partial<SkillContext['env']>): SkillContext {
  return {
    taskId: 'task-1',
    stepId: 'step-1',
    env: env as SkillContext['env']
  }
}

function createInput(model?: string): SkillInput {
  return {
    messages: [{ role: 'user', content: 'hello' }],
    model
  }
}

describe('resolveTextProvider', () => {
  const compatible = {
    TEXT_API_KEY: 'synthetic-compatible-key',
    TEXT_API_BASE_URL: 'https://provider.test/v1',
    DEFAULT_MODEL: 'deepseek-flash',
    DEFAULT_FILE_MODEL: 'deepseek-flash'
  }

  it.each(['text', 'file'])(
    'routes configured %s requests to the compatible model instead of a legacy fallback',
    (kind) => {
      const context = createContext({ ...compatible, QWEN_API_KEY: 'synthetic-old-key' })
      const selected = selectSkill(kind === 'file' ? { files: [{}] } : {}, context.env)
      expect(selected.model).toBe('deepseek-flash')
      const input = createInput(selected.model)
      const model = kind === 'file' ? selectFileTextExecutor(input, context).model : selected.model
      expect(resolveTextProvider({ ...input, model }, context)).toMatchObject({
        provider: 'compatible',
        model: 'deepseek-flash',
        url: 'https://provider.test/v1/chat/completions',
        apiKey: 'synthetic-compatible-key'
      })
    }
  )

  it.each(['https://provider.test', 'https://provider.test/v1/'])(
    'normalizes compatible base URL %s without losing its path',
    (baseURL) => {
      const provider = resolveTextProvider(
        createInput('deployed-alias'),
        createContext({
          ...compatible,
          TEXT_API_BASE_URL: baseURL
        })
      )
      expect(provider?.url).toBe(baseURL.replace(/\/+$/, '') + '/chat/completions')
      expect(provider?.model).toBe('deployed-alias')
    }
  )

  it.each([
    { TEXT_API_KEY: 'synthetic-compatible-key' },
    { TEXT_API_BASE_URL: 'https://provider.test/v1' },
    { TEXT_API_KEY: ' ', TEXT_API_BASE_URL: 'https://provider.test/v1' },
    { TEXT_API_KEY: 'synthetic-compatible-key', TEXT_API_BASE_URL: ' ' }
  ])(
    'fails closed for incomplete compatible configuration even when Bailian has credentials',
    (custom) => {
      const context = createContext({ QWEN_API_KEY: 'synthetic-old-key', ...custom })
      expect(hasTextProviderCredentials(context.env)).toBe(false)
      expect(resolveTextProvider(createInput(), context)).toBeNull()
    }
  )

  it.each([
    '/v1',
    'http://provider.test/v1',
    'https://user:password@provider.test/v1',
    'https://provider.test/v1?api_key=secret',
    'https://provider.test/v1#fragment'
  ])(
    'rejects unsafe endpoint %s without including configured credentials in its error',
    (baseURL) => {
      expect(() =>
        resolveTextProvider(
          createInput(),
          createContext({
            ...compatible,
            TEXT_API_BASE_URL: baseURL
          })
        )
      ).toThrow(
        expect.objectContaining({
          code: 'MODEL_CONFIG_INVALID',
          message: '文本模型接口配置无效，请检查服务地址。'
        })
      )
    }
  )

  it('默认优先走百炼兜底供应商', () => {
    const provider = resolveTextProvider(createInput(), createContext({ QWEN_API_KEY: 'qwen-key' }))

    expect(provider).not.toBeNull()
    expect(provider?.provider).toBe('bailian')
    expect(provider?.model).toBe(DEFAULT_QWEN_TEXT_MODEL)
  })

  it('显式指定 kimi 模型时仍然走百炼兼容接口', () => {
    const provider = resolveTextProvider(
      createInput('kimi-k2.5'),
      createContext({ QWEN_API_KEY: 'qwen-key' })
    )

    expect(provider?.provider).toBe('bailian')
    expect(provider?.model).toBe('kimi-k2.5')
  })

  it('显式指定 minimax 模型时仍然走百炼兼容接口', () => {
    const provider = resolveTextProvider(
      createInput('MiniMax-M2.5'),
      createContext({ QWEN_API_KEY: 'qwen-key' })
    )

    expect(provider?.provider).toBe('bailian')
    expect(provider?.model).toBe('MiniMax-M2.5')
  })

  it('默认模型显式配置为百炼模型时应命中百炼', () => {
    const provider = resolveTextProvider(
      createInput(),
      createContext({
        DEFAULT_MODEL: DEFAULT_QWEN_TEXT_MODEL,
        QWEN_API_KEY: 'qwen-key'
      })
    )

    expect(provider?.provider).toBe('bailian')
    expect(provider?.model).toBe(DEFAULT_QWEN_TEXT_MODEL)
  })
})
