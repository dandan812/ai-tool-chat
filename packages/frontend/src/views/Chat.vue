<script setup lang="ts">
/**
 * 聊天主页面
 *
 * 这个文件是当前前端聊天工作台的页面级入口，主要负责三件事：
 * 1. 组织页面布局：左侧边栏 + 顶部头部 + 中间消息流 + 底部输入区
 * 2. 作为页面协调层，把子组件事件转发给 Store
 * 3. 处理只属于“页面显示层”的状态，例如移动端侧边栏开关
 *
 * 这里刻意不把会话、消息、步骤、流式内容等核心业务状态放在页面本身，
 * 而是统一交给 Pinia Store 管理。这样 Sidebar、Header、Messages、Input
 * 都能共享同一份聊天状态，不会出现多个组件各自维护一套状态而互相打架。
 */
import { ref, watch } from 'vue'
import { useChatStore } from '../stores/chat'
import type { ImageData, UploadedFileRef } from '../types/task'

// 组件导入：
// - Sidebar：左侧会话列表和主题切换
// - ChatHeader：顶部当前会话标题、状态、清空操作
// - ChatMessages：中间消息流与欢迎页
// - ChatInput：底部输入、附件、发送/停止按钮
// - StepIndicator：当前任务步骤摘要与详情
// - Toast：全局轻提示
// - ErrorBoundary：局部组件渲染异常兜底
import Sidebar from '../components/Sidebar.vue'
import ChatHeader from '../components/ChatHeader.vue'
import ChatMessages from '../components/ChatMessages.vue'
import ChatInput from '../components/ChatInput.vue'
import StepIndicator from '../components/StepIndicator.vue'
import Toast from '../components/Toast.vue'
import ErrorBoundary from '../components/ErrorBoundary.vue'

// ==================== 状态管理 ====================

// 聊天主状态统一来自 Pinia。
// 页面层只“读取/调用” Store，不重复定义一份业务状态。
const store = useChatStore()

// 侧边栏展开状态只服务于当前页面的 UI 展示，属于局部页面状态，
// 没必要提升到 Store。
const isSidebarOpen = ref(false)

// ==================== 监听器 ====================

// 会话切换时，只清理当前页面正在展示的流式内容。
//
// 这里要注意两个概念：
// 1. “后台请求是否继续执行” 属于任务生命周期问题，由 Store 控制
// 2. “当前屏幕应该显示哪段流式内容” 属于展示层问题，由页面负责清理
//
// 所以这里不会主动中止后台请求，只会避免把旧会话的流式显示残留到新会话上。
watch(
  () => store.currentSessionId,
  () => {
    // 清理当前显示的流式内容，防止切换会话后消息区域出现串屏。
    store.clearStreamingContent()
  }
)

// ==================== 方法 ====================

/**
 * 切换移动端侧边栏开关
 *
 * 桌面端通常常驻显示侧边栏；
 * 移动端则通过 Header 中的菜单按钮控制显隐。
 */
function toggleSidebar() {
  isSidebarOpen.value = !isSidebarOpen.value
}

/**
 * 关闭移动端侧边栏
 *
 * 主要用于：
 * - 点击遮罩关闭
 * - 未来如果需要，也可以在选择会话后主动关闭
 */
function closeSidebar() {
  isSidebarOpen.value = false
}

/**
 * 发送消息（支持多模态和文件）
 *
 * 这个函数本身不做消息拼装、请求发送、SSE 解析这些底层工作，
 * 只负责把页面收到的输入内容转交给 Store。
 *
 * 参数说明：
 * - content：用户输入的文本
 * - images：用户附带的图片数据
 * - files：已上传成功的文件引用
 *
 * 真正的主链路在 `store.sendTaskMessage(...)`：
 * 1. 写入用户消息
 * 2. 插入空的 assistant 占位消息
 * 3. 发起请求
 * 4. 消费 SSE
 * 5. 持续更新任务、步骤和流式内容
 */
async function handleSend(content: string, images: ImageData[] = [], files: UploadedFileRef[] = []) {
  await store.sendTaskMessage(content, images, files)
}

/**
 * 停止当前请求
 *
 * 底层会通过 AbortController 中止当前会话的流式请求，
 * 并把“生成中”状态切回空闲态。
 */
function handleStop() {
  store.stopGeneration()
}
</script>

<template>
  <!--
    页面最外层布局容器：
    - 左边放 Sidebar
    - 右边放完整聊天工作区
    整个页面使用 flex 横向分栏。
  -->
  <div class="app-layout">
    <!--
      移动端侧边栏遮罩：
      只有当侧边栏展开时才出现。
      点击遮罩会关闭侧边栏，避免用户必须再点一次菜单按钮。
    -->
    <div
      v-if="isSidebarOpen"
      class="sidebar-overlay"
      @click="closeSidebar"
    />

    <!--
      侧边栏区域。
      用 ErrorBoundary 包起来的目的是：即使会话列表渲染炸了，
      主聊天区也尽量还能继续工作，不让整个页面白屏。
    -->
    <ErrorBoundary title="侧边栏渲染失败" message="会话列表暂时无法显示，请重试。">
      <Sidebar :is-open="isSidebarOpen" />
    </ErrorBoundary>

    <!--
      主聊天区域：
      这一列承担聊天页的核心功能，但自身仍然只负责“搭骨架”，
      具体内容由内部组件分别渲染。
    -->
    <div class="chat-layout">
      <div class="chat-stage">
        <!--
          顶部头部：
          展示当前会话标题、任务状态、模型标签、清空按钮。
          同时在移动端负责触发侧边栏展开。
        -->
        <ChatHeader @toggle-sidebar="toggleSidebar" />

        <!--
          消息流区域：
          这里单独包一层是为了把“可滚动的消息区域”和“底部固定输入区”分离开。
          否则消息和输入区会抢高度，滚动体验也会变差。
        -->
        <div class="chat-stream">
          <ErrorBoundary title="消息区域渲染失败" message="消息列表暂时无法显示，请重试。">
            <ChatMessages @send="handleSend" />
          </ErrorBoundary>
        </div>

        <!--
          底部输入工作区：
          固定在页面底部，包含两块内容：
          1. StepIndicator：展示当前任务执行进度
          2. ChatInput：收集输入、附件并触发发送
        -->
        <footer class="chat-footer">
          <div class="composer-shell">
            <ErrorBoundary title="输入区域渲染失败" message="输入区暂时不可用，请重试。">
              <!--
                步骤条直接从当前会话对应的运行态里取数据。
                这样用户切换会话时，看到的是该会话自己的任务过程。
              -->
              <StepIndicator
                :task="store.getCurrentTask(store.currentSessionId)"
                :steps="store.getSteps(store.currentSessionId)"
              />

              <!--
                输入区需要知道两件事：
                1. 当前会话 ID：发送消息时归属到哪个会话
                2. 当前是否正在生成：决定显示“发送”还是“停止”
                组件本身不直接请求后端，而是通过事件把动作抛回页面。
              -->
              <ChatInput
                :session-id="store.currentSessionId"
                :loading="store.isSessionLoading(store.currentSessionId)"
                @send="handleSend"
                @stop="handleStop"
              />
            </ErrorBoundary>
          </div>
        </footer>
      </div>
    </div>

    <!-- 存储错误提示 -->
    <Toast
      :show="!!store.storageError"
      message="存储空间不足，已清理部分旧数据"
      type="warning"
      @close="store.storageError = null"
    />
  </div>
</template>

<style scoped>
/* 整个页面采用左右双栏布局，并用暖色渐变制造工作台氛围。 */
.app-layout {
  display: flex;
  height: 100vh;
  overflow: hidden;
  background:
    radial-gradient(circle at top left, rgba(201, 106, 23, 0.08), transparent 28%),
    linear-gradient(180deg, var(--surface-canvas) 0%, var(--bg-primary) 100%);
}

/* 移动端侧边栏展开时的全屏遮罩。 */
.sidebar-overlay {
  position: fixed;
  inset: 0;
  background: rgba(24, 20, 17, 0.36);
  backdrop-filter: blur(8px);
  z-index: 50;
}

/* 右侧聊天主列，占据除 Sidebar 之外的全部剩余空间。 */
.chat-layout {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}

/* 页面内部真正的聊天舞台，负责承载头部、消息流和底部输入区。 */
.chat-stage {
  --layout-scrollbar-compensation: 14px;
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  position: relative;
  isolation: isolate;
}

/* 给主区域铺一层轻微的背景光影，但不影响交互。 */
.chat-stage::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(circle at top right, rgba(201, 106, 23, 0.08), transparent 28%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.06), transparent 22%);
  opacity: 0.8;
  z-index: -1;
}

/* 暗色主题下使用不同的高光配色，避免浅色背景光斑太突兀。 */
[data-theme='dark'] .chat-stage::before {
  background:
    radial-gradient(circle at top right, rgba(251, 191, 36, 0.08), transparent 24%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.02), transparent 18%);
}

/* 消息流区域独立占满剩余高度，内部真正滚动由 ChatMessages 组件承担。 */
.chat-stream {
  flex: 1;
  display: flex;
  min-height: 0;
  position: relative;
  overflow: hidden;
  scroll-padding-bottom: 220px;
}

/* 底部输入区使用 sticky，滚动长对话时仍保持可见。 */
.chat-footer {
  flex-shrink: 0;
  position: sticky;
  bottom: 0;
  z-index: 20;
  padding: 0 calc(var(--space-6) + var(--layout-scrollbar-compensation)) var(--space-5) var(--space-6);
  background:
    linear-gradient(180deg, rgba(252, 251, 248, 0) 0%, rgba(252, 251, 248, 0.78) 24%, rgba(252, 251, 248, 0.96) 100%);
  backdrop-filter: blur(14px);
}

/* 暗色主题下同步调整底部渐变遮罩，避免底部区域发灰。 */
[data-theme='dark'] .chat-footer {
  background:
    linear-gradient(180deg, rgba(10, 10, 10, 0) 0%, rgba(10, 10, 10, 0.72) 24%, rgba(10, 10, 10, 0.94) 100%);
}

/* 输入工作区的内容版心，保证步骤条和输入框与头部、消息列表宽度对齐。 */
.composer-shell {
  width: min(100%, var(--layout-content-max));
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding-bottom: max(0px, env(safe-area-inset-bottom));
}

/* 移动端下适当收紧底部留白和版心间距。 */
@media (max-width: 768px) {
  .chat-stage {
    --layout-scrollbar-compensation: 0px;
  }

  .chat-stream {
    scroll-padding-bottom: 180px;
  }

  .chat-footer {
    padding: 0 var(--space-4) var(--space-4);
  }

  .composer-shell {
    gap: var(--space-2);
  }
}
</style>
