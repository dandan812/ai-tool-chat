export interface SuggestionCard {
  title: string
  description: string
  prompt: string
}

const ALL_WELCOME_SUGGESTIONS: SuggestionCard[] = [
  {
    title: '分析一份长文档',
    description: '上传文本、日志或代码文件，然后让 AI 只针对关键片段回答。',
    prompt: '帮我概括这份文件的关键结论，并指出最值得继续追问的部分。'
  },
  {
    title: '拆解一个功能方案',
    description: '把需求拆成结构清晰的实现步骤，而不是泛泛建议。',
    prompt: '帮我把这个功能需求拆成前端、后端和验证三部分执行清单。'
  },
  {
    title: '理解一张截图',
    description: '上传图片后，获取界面结构、异常点或文案问题分析。',
    prompt: '请分析这张截图里的信息结构、视觉层级和可用性问题。'
  },
  {
    title: '整理一段对话',
    description: '把杂乱输入整理成要点、风险和下一步行动。',
    prompt: '请把这段信息整理成摘要、待办和需要澄清的问题。'
  },
  {
    title: '快速写一版文案',
    description: '适合产品介绍、功能说明、发布说明等短文本场景。',
    prompt: '帮我写一版简洁但专业的产品介绍文案，突出核心价值。'
  },
  {
    title: '阅读一段代码',
    description: '直接贴代码或上传文件，优先解释结构和风险点。',
    prompt: '请阅读这段代码，解释它的作用、边界条件和潜在问题。'
  }
]

export function pickWelcomeSuggestions(count: number = 4): SuggestionCard[] {
  const shuffled = [...ALL_WELCOME_SUGGESTIONS].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, count)
}
