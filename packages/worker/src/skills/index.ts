import type { Env, Skill, ToolingMode } from '../types'
import { resolveMultimodalModel } from '../model/defaultModels'
import {
  getTextModelProviderLabel,
  isBailianTextModel,
  resolveDefaultFileModel,
  resolveDefaultTextModel
} from '../model/textModel'
import { textSkill } from './textSkill'
import { multimodalSkill } from './multimodalSkill'
import { fileSkill } from './fileSkill'
import { fileAgentSkill } from './fileAgentSkill'

export interface SelectedSkill {
  skill: Skill
  model: string
  label: string
  description: string
  toolingMode: ToolingMode
}

/** Input selects the capability; a model override cannot bypass attachment handling. */
export function selectSkill(
  input: { images?: unknown[]; files?: unknown[]; model?: string; enableTools?: boolean },
  env?: Pick<Env, 'DEFAULT_MODEL' | 'DEFAULT_FILE_MODEL' | 'DEFAULT_MULTIMODAL_MODEL'>
): SelectedSkill {
  const { images = [], files = [], model } = input
  const toolingMode: ToolingMode =
    input.enableTools && files.length > 0 && images.length === 0 ? 'active' : 'disabled'

  function selection(
    skill: Skill,
    model: string,
    label: string,
    description: string
  ): SelectedSkill {
    return { skill, model, label, description, toolingMode }
  }

  if (images.length > 0) {
    const selectedModel = resolveMultimodalModel(model, env)
    return selection(multimodalSkill, selectedModel, '多模态处理', `调用 ${selectedModel} 处理图文`)
  }

  if (files.length > 0) {
    const selectedModel = model || resolveDefaultFileModel(env)
    return input.enableTools
      ? selection(fileAgentSkill, selectedModel, '资料研究', '按需检索与读取原文')
      : selection(fileSkill, selectedModel, '文件分析', `调用 ${selectedModel} 分析上传内容`)
  }

  const selectedModel = model && isBailianTextModel(model) ? model : resolveDefaultTextModel(env)
  return selection(
    textSkill,
    selectedModel,
    `${getTextModelProviderLabel(selectedModel)} 文本对话`,
    `调用 ${selectedModel} 生成回复`
  )
}
