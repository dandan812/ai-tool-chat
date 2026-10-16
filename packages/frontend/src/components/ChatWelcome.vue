<script setup lang="ts">
import { FileText, Code2, ListChecks, ArrowUpRight } from '@lucide/vue'

defineEmits<{ prompt: [value: string] }>()
const starters = [
  {
    title: '梳理文档',
    icon: FileText,
    prompt: '请帮我梳理以下文档，提炼核心结论、关键依据和待确认事项：\n'
  },
  {
    title: '分析问题',
    icon: Code2,
    prompt: '请帮我分析以下问题，定位可能原因，并给出可验证的解决方案：\n'
  },
  {
    title: '制定计划',
    icon: ListChecks,
    prompt: '请把以下目标拆解为执行计划，列出步骤、交付物和主要风险：\n'
  }
]
</script>

<template>
  <section class="welcome-shell" aria-label="新对话">
    <span class="welcome-wordmark">AI Tool Chat / 工作台</span>
    <h2>从一个问题，开始今天的工作。</h2>
    <div class="welcome-actions" aria-label="开始任务">
      <button
        v-for="starter in starters"
        :key="starter.title"
        class="starter-action"
        @click="$emit('prompt', starter.prompt)"
      >
        <component :is="starter.icon" />
        <span>{{ starter.title }}</span>
        <ArrowUpRight class="starter-arrow" />
      </button>
    </div>
  </section>
</template>
