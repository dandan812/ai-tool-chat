<script setup lang="ts">
/**
 * 工具型欢迎页
 *
 * 目标：
 * - 把首页从陪聊入口改成工作流入口
 * - 明确展示平台支持的输入方式和建议任务
 *
 * @package frontend/src/components
 */

import { onMounted, ref } from 'vue'

interface SuggestionCard {
  title: string
  description: string
  prompt: string
}

const emit = defineEmits<{
  /** 选择建议提问 */
  select: [suggestion: string]
}>()

const allSuggestions: SuggestionCard[] = [
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

/** 当前展示的建议卡片 */
const suggestions = ref<SuggestionCard[]>([])

/** 刷新建议列表 */
function generateSuggestions() {
  const shuffled = [...allSuggestions].sort(() => Math.random() - 0.5)
  suggestions.value = shuffled.slice(0, 4)
}

defineExpose({
  refresh: generateSuggestions
})

onMounted(generateSuggestions)
</script>

<template>
  <section class="welcome-shell">
    <div class="hero">
      <div class="hero-copy">
        <span class="eyebrow">Warm Editorial Workspace</span>
        <h1 class="hero-title">把一条问题，推进成一条清晰的工作流。</h1>
        <p class="hero-subtitle">
          这里不是单纯的聊天窗口。你可以直接输入需求、上传图片、挂载文件，
          再跟着任务步骤把信息整理、分析和输出收口。
        </p>

        <div class="capability-row">
          <span class="capability-chip">文本对话</span>
          <span class="capability-chip">图片理解</span>
          <span class="capability-chip">文件引用</span>
          <span class="capability-chip">步骤追踪</span>
        </div>
      </div>

      <div class="hero-panel">
        <div class="panel-kicker">推荐起手式</div>
        <ul class="starter-list">
          <li>先给一个明确目标，再补充上下文。</li>
          <li>如果问题依赖文件，请先上传文件再追问。</li>
          <li>如果你要结论更准，尽量限定范围和输出格式。</li>
        </ul>
      </div>
    </div>

    <div class="suggestion-grid">
      <button
        v-for="(suggestion, index) in suggestions"
        :key="suggestion.title"
        class="suggestion-card"
        :style="{ animationDelay: `${index * 80}ms` }"
        @click="emit('select', suggestion.prompt)"
      >
        <span class="suggestion-title">{{ suggestion.title }}</span>
        <span class="suggestion-description">{{ suggestion.description }}</span>
        <span class="suggestion-action">直接开始</span>
      </button>
    </div>
  </section>
</template>

<style scoped>
.welcome-shell {
  display: flex;
  flex-direction: column;
  gap: var(--space-8);
  min-height: calc(100vh - 260px);
  padding: var(--space-8) 0 var(--space-12);
}

.hero {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(280px, 0.8fr);
  gap: var(--space-6);
  align-items: stretch;
}

.hero-copy,
.hero-panel {
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-xl);
  background: linear-gradient(180deg, var(--surface-panel) 0%, var(--surface-strong) 100%);
  box-shadow: var(--shadow-panel);
}

.hero-copy {
  padding: var(--space-8);
}

.eyebrow {
  display: inline-flex;
  margin-bottom: var(--space-4);
  color: var(--accent-primary);
  font-size: var(--text-xs);
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.hero-title {
  max-width: 14ch;
  font-size: clamp(2.2rem, 3vw, 3.4rem);
  line-height: 1.05;
  letter-spacing: -0.04em;
}

.hero-subtitle {
  margin-top: var(--space-5);
  max-width: 620px;
  color: var(--text-secondary);
  font-size: var(--text-lg);
  line-height: 1.8;
}

.capability-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-top: var(--space-6);
}

.capability-chip {
  display: inline-flex;
  align-items: center;
  min-height: 34px;
  padding: 0.3rem 0.75rem;
  border-radius: var(--radius-pill);
  background: var(--surface-muted);
  color: var(--text-secondary);
  font-size: var(--text-xs);
  font-weight: 700;
}

.hero-panel {
  padding: var(--space-6);
}

.panel-kicker {
  color: var(--text-tertiary);
  font-size: var(--text-xs);
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.starter-list {
  margin-top: var(--space-4);
  padding-left: var(--space-5);
  color: var(--text-secondary);
  line-height: 1.8;
}

.starter-list li + li {
  margin-top: var(--space-3);
}

.suggestion-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-4);
}

.suggestion-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-3);
  padding: var(--space-5);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-xl);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.72) 0%, var(--surface-strong) 100%);
  cursor: pointer;
  text-align: left;
  transition: transform var(--transition-fast), box-shadow var(--transition-fast), border-color var(--transition-fast);
  animation: card-in var(--transition-slow) ease-out both;
}

.suggestion-card:hover {
  transform: translateY(-2px);
  border-color: rgba(201, 106, 23, 0.18);
  box-shadow: var(--shadow-float);
}

.suggestion-title {
  color: var(--text-primary);
  font-size: var(--text-lg);
  font-weight: 700;
}

.suggestion-description {
  color: var(--text-secondary);
  font-size: var(--text-sm);
  line-height: 1.7;
}

.suggestion-action {
  display: inline-flex;
  align-items: center;
  min-height: 30px;
  padding: 0.2rem 0.6rem;
  border-radius: var(--radius-pill);
  background: var(--accent-soft);
  color: var(--accent-primary);
  font-size: var(--text-xs);
  font-weight: 700;
}

@keyframes card-in {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (max-width: 900px) {
  .hero {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 768px) {
  .welcome-shell {
    min-height: auto;
    padding: var(--space-5) 0 var(--space-8);
  }

  .hero-copy,
  .hero-panel {
    padding: var(--space-5);
  }

  .hero-title {
    max-width: none;
    font-size: clamp(1.9rem, 10vw, 2.8rem);
  }

  .hero-subtitle {
    font-size: var(--text-base);
  }

  .suggestion-grid {
    grid-template-columns: 1fr;
  }
}
</style>
