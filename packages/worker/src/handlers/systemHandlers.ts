import type { Env } from '../types'
import { createJSONResponse } from '../infrastructure/middleware'
import { hasTextProviderCredentials } from '../providers/textProvider'
import { hasMultimodalProviderCredentials } from '../providers/multimodalProvider'

/**
 * 保留历史字段名，文本能力同时涵盖部署配置的兼容接口。
 */
export function handleHealthCheck(env: Env): Response {
  return createJSONResponse({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '2.0.0',
    features: {
      bailianText: hasTextProviderCredentials(env),
      bailianMultimodal: hasMultimodalProviderCredentials(env)
    }
  })
}
