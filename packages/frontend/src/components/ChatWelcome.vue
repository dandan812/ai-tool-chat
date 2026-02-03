<script setup lang="ts">
/**
 * 欢迎页组件 - 《反主流》美学
 * 
 * 设计理念：
 * - 大留白 + 有机圆角
 * - 手绘感的温暖图标
 * - 深灰 + 橙色强调
 */
import { ref, onMounted } from 'vue'

const emit = defineEmits<{
  select: [suggestion: string]
}>()

// 精选提问 - 更有人情味
const allSuggestions = [
  '帮我设计一个个人网站',
  '写一段温暖的产品介绍文案',
  '推荐一本让人平静的书',
  '用代码画一个会动的太阳',
  '帮我规划一次治愈系旅行',
  '写一个关于咖啡的小故事',
  '如何用设计表达情感？',
  '帮我写一首给朋友的诗',
  '什么是好的用户体验？',
  '推荐一些独立音乐',
  '如何用色彩传达温暖？',
  '帮我制定一个晨间routine'
]

const suggestions = ref<string[]>([])

function generateSuggestions() {
  const shuffled = [...allSuggestions].sort(() => 0.5 - Math.random())
  suggestions.value = shuffled.slice(0, 4)
}

defineExpose({
  refresh: generateSuggestions
})

onMounted(generateSuggestions)
</script>

<template>
  <div class="welcome-container">
    <!-- 手绘风格图标 -->
    <div class="welcome-brand">
      <div class="brand-icon">
        <svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
          <!-- 手绘风格背景圆 -->
          <circle cx="60" cy="60" r="55" class="icon-bg"/>
          <!-- 手绘风格对话框 -->
          <path d="M35 45C35 38.9249 39.9249 34 46 34H74C80.0751 34 85 38.9249 85 45V65C85 71.0751 80.0751 76 74 76H55L40 86V76H35C28.9249 76 24 71.0751 24 65V45C24 38.9249 28.9249 34 35 34" 
                stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
          <!-- 温暖的点缀 - 小太阳 -->
          <circle cx="88" cy="32" r="8" class="sun-icon"/>
          <path d="M88 20V24M88 40V44M76 32H80M96 32H100M79 23L82 26M94 38L97 41M79 41L82 38M94 26L97 23" 
                stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          <!-- 对话点 -->
          <circle cx="48" cy="55" r="4" fill="currentColor"/>
          <circle cx="60" cy="55" r="4" fill="currentColor"/>
          <circle cx="72" cy="55" r="4" fill="currentColor"/>
        </svg>
      </div>
      
      <h1 class="welcome-title">你好，朋友</h1>
      <p class="welcome-subtitle">
        我是你的 AI 伙伴，一个相信技术应该有温度的存在。<br/>
        有什么想法，我们聊聊？
      </p>
    </div>

    <!-- 快速操作卡片 -->
    <div class="suggestions-grid">
      <button
        v-for="(suggestion, index) in suggestions"
        :key="suggestion"
        class="suggestion-card"
        :style="{ animationDelay: `${index * 100}ms` }"
        @click="emit('select', suggestion)"
      >
        <span class="card-text">{{ suggestion }}</span>
        <span class="card-arrow">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="5" y1="12" x2="19" y2="12"></line>
            <polyline points="12 5 19 12 12 19"></polyline>
          </svg>
        </span>
      </button>
    </div>

    <!-- 底部提示 -->
    <p class="welcome-hint">
      <span class="hint-icon">💡</span>
      点击卡片开始对话，或直接在下方输入你的想法
    </p>
  </div>
</template>

<style scoped>
.welcome-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 70vh;
  padding: var(--space-8);
  animation: fadeIn 0.8s ease-out;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* 品牌区域 */
.welcome-brand {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  margin-bottom: var(--space-12);
}

.brand-icon {
  width: 100px;
  height: 100px;
  margin-bottom: var(--space-8);
  color: var(--accent-primary);
  animation: gentleFloat 4s ease-in-out infinite;
}

@keyframes gentleFloat {
  0%, 100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-8px);
  }
}

.brand-icon svg {
  width: 100%;
  height: 100%;
}

.icon-bg {
  fill: var(--accent-primary);
  opacity: 0.1;
}

.sun-icon {
  fill: var(--amber-400);
}

/* 标题 - Space Grotesk 个性 */
.welcome-title {
  font-family: var(--font-display);
  font-size: var(--text-4xl);
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: -0.03em;
  margin-bottom: var(--space-4);
}

/* 副标题 */
.welcome-subtitle {
  font-size: var(--text-lg);
  color: var(--text-secondary);
  line-height: 1.7;
  max-width: 480px;
}

/* 建议卡片网格 */
.suggestions-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--space-4);
  width: 100%;
  max-width: 640px;
  margin-bottom: var(--space-10);
}

.suggestion-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-5) var(--space-6);
  background: var(--bg-elevated);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-xl);
  text-align: left;
  cursor: pointer;
  transition: all var(--transition-base);
  animation: slideUp 0.5s ease-out backwards;
  opacity: 0.9;
}

@keyframes slideUp {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 0.9;
    transform: translateY(0);
  }
}

.suggestion-card:hover {
  background: var(--bg-tertiary);
  border-color: var(--border-default);
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
  opacity: 1;
}

.card-text {
  font-size: var(--text-sm);
  color: var(--text-secondary);
  line-height: 1.5;
}

.suggestion-card:hover .card-text {
  color: var(--text-primary);
}

.card-arrow {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: var(--bg-tertiary);
  border-radius: var(--radius-md);
  color: var(--text-muted);
  transition: all var(--transition-fast);
  flex-shrink: 0;
  margin-left: var(--space-3);
}

.suggestion-card:hover .card-arrow {
  background: var(--accent-primary);
  color: white;
  transform: translateX(2px);
}

/* 底部提示 */
.welcome-hint {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-sm);
  color: var(--text-muted);
}

.hint-icon {
  font-size: var(--text-base);
}

/* 响应式 */
@media (max-width: 640px) {
  .welcome-container {
    padding: var(--space-6);
    min-height: 60vh;
  }
  
  .brand-icon {
    width: 80px;
    height: 80px;
  }
  
  .welcome-title {
    font-size: var(--text-3xl);
  }
  
  .welcome-subtitle {
    font-size: var(--text-base);
  }
  
  .suggestions-grid {
    grid-template-columns: 1fr;
  }
  
  .suggestion-card {
    padding: var(--space-4) var(--space-5);
  }
}
</style>
