import type { Message, Skill, SkillContext, SkillInput } from '../types'
import { resolveDefaultFileModel } from '../model/defaultModels'
import { getTextModelProviderLabel } from '../model/textModel'
import { textSkill } from './textSkill'

const SMALL_FILE_DIRECT_TOKEN_THRESHOLD = 12000
const SUMMARY_REQUEST_PATTERN =
  /(整体|全文|全篇|整体结构|全文概览|整体概览|总结整[份个]文件|总结全文|通读|概述|梳理|分析一下|分析下|介绍一下|主要讲|讲了什么|说了什么|内容是什么|overview|overall|summary|summari[sz]e)/i
const CODE_EXTENSIONS = new Set([
  'js',
  'jsx',
  'mjs',
  'ts',
  'tsx',
  'py',
  'java',
  'go',
  'rs',
  'c',
  'cpp',
  'cc',
  'h',
  'hpp',
  'cs',
  'php',
  'rb',
  'swift',
  'kt',
  'scala',
  'dart',
  'lua',
  'r',
  'sql',
  'sh',
  'bash'
])

export function isCodeFile(filename: string): boolean {
  return CODE_EXTENSIONS.has((filename.split('.').pop() || '').toLowerCase())
}

export function resolveFileUserQuestion(messages: Message[]): string {
  const lastUserMessage = [...messages].reverse().find((message) => message.role === 'user')
  return lastUserMessage?.content || '请分析这些文件'
}

/** Reuse text generation, including its stream and budget controls, for file answers. */
export function selectFileTextExecutor(
  input: SkillInput,
  context: SkillContext
): { execute: Skill['execute']; model: string } {
  const model = typeof input.model === 'string' ? input.model : ''
  return {
    execute: textSkill.execute,
    model:
      model && getTextModelProviderLabel(model) !== '文本'
        ? model
        : resolveDefaultFileModel(context.env)
  }
}

export function shouldPreferDirectFileAnswer(totalTokens: number, fileCount: number): boolean {
  return fileCount <= 2 && totalTokens <= SMALL_FILE_DIRECT_TOKEN_THRESHOLD
}

export function shouldPreferGlobalSummary(userQuestion: string): boolean {
  return SUMMARY_REQUEST_PATTERN.test(userQuestion)
}
