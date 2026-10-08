<script setup lang="ts">
import { MessageSquare, ArrowUpRight } from '@lucide/vue'

const emit = defineEmits<{ select: [suggestion: string] }>()
const suggestions = [
  '解释这段代码的作用、边界条件和潜在问题',
  '把这个功能需求拆成前端、后端和验证清单',
  '整理这些信息，列出结论、风险和待确认的问题'
]
</script>

<template>
  <section class="welcome-shell" aria-label="新对话">
    <div class="welcome-heading">
      <MessageSquare />
      <h1>新对话</h1>
    </div>
    <p class="welcome-subtitle">今天想解决什么问题？</p>
    <div class="suggestion-list">
      <button
        v-for="suggestion in suggestions"
        :key="suggestion"
        class="suggestion-card"
        @click="emit('select', suggestion)"
      >
        <span>{{ suggestion }}</span
        ><ArrowUpRight />
      </button>
    </div>
  </section>
</template>
