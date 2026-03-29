# Task Pipeline Unification Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将当前聊天系统收口为单一的 Task 主链路，消除旧新 API 并存、状态分散、步骤信息未落 UI、文案与实现不一致的问题。

**Architecture:** 前端改为 `UI -> ChatStore -> sendTaskRequest -> Worker` 的单一路径，由 Store 统一管理会话消息、当前任务、步骤、流式内容和错误。后端继续保留 `Task -> Step -> Skill` 架构，但让步骤名称、模型信息和工具能力状态从真实 skill 选择结果导出，避免静态文案漂移。

**Tech Stack:** Vue 3、Pinia、TypeScript、Vite、Cloudflare Workers、SSE

---

### Task 1: 收口前端请求入口到 ChatStore

**Files:**
- Modify: `packages/frontend/src/stores/chat.ts`
- Modify: `packages/frontend/src/views/Chat.vue`
- Modify: `packages/frontend/src/components/ChatMessages.vue`
- Modify: `packages/frontend/src/components/ChatInput.vue`
- Modify: `packages/frontend/src/api/task.ts`
- Reference: `packages/frontend/src/api/ai.ts`

**Step 1: 在 ChatStore 中定义新的 Task 状态模型**

在 `packages/frontend/src/stores/chat.ts` 增加以下状态与方法：

```ts
import { sendTaskRequest } from '../api/task'
import type { Task, Step, ImageData, FileData } from '../types/task'

const currentTaskMap = ref<Record<string, Task | null>>({})
const stepMap = ref<Record<string, Step[]>>({})
const sessionErrorMap = ref<Record<string, string | null>>({})

function setCurrentTask(sessionId: string, task: Task | null) {
  currentTaskMap.value[sessionId] = task
}

function setSteps(sessionId: string, steps: Step[]) {
  stepMap.value[sessionId] = steps
}

function upsertStep(sessionId: string, step: Step) {
  const list = stepMap.value[sessionId] ?? []
  const index = list.findIndex((item) => item.id === step.id)
  if (index >= 0) {
    list[index] = step
  } else {
    list.push(step)
  }
  stepMap.value[sessionId] = [...list]
}
```

**Step 2: 新增 `sendTaskMessage()` 作为唯一发送入口**

在 `packages/frontend/src/stores/chat.ts` 中新增方法，替代旧的 `sendMessage()`：

```ts
async function sendTaskMessage(
  content: string,
  images: ImageData[] = [],
  files: FileData[] = []
): Promise<void> {
  const sessionId = currentSessionId.value
  if (!sessionId || isSessionLoading(sessionId)) return

  const trimmed = content.trim()
  const userContent =
    trimmed ||
    (images.length > 0 ? '[图片]' : '') ||
    (files.length > 0 ? `[文件: ${files.map((file) => file.name).join(', ')}]` : '')

  const history = (messagesMap.value[sessionId] ?? [])
    .filter((message) => message.content.trim().length > 0)
    .map((message) => ({ role: message.role, content: message.content }))

  const userMessage = {
    role: 'user' as const,
    content: userContent || '[消息]'
  }

  const requestMessages = [...history, userMessage]
  addMessage(sessionId, userMessage)
  addMessage(sessionId, { role: 'assistant', content: '' })

  const assistantIndex = (messagesMap.value[sessionId] ?? []).length - 1
  setSessionLoading(sessionId, true)
  setSteps(sessionId, [])
  setCurrentTask(sessionId, null)

  await sendTaskRequest(
    {
      messages: requestMessages,
      images: images.length ? images : undefined,
      files: files.length ? files : undefined,
      temperature: 0.7
    },
    { /* 见 Task 2 */ }
  )
}
```

**Step 3: 删除页面级请求编排**

在 `packages/frontend/src/views/Chat.vue` 中移除：
- `sendTaskRequest` import
- `AbortController` 的页面级管理
- `handleSend()` 内部的请求实现

将页面改为只调用 store：

```ts
async function handleSend(content: string, images: ImageData[] = [], files: FileData[] = []) {
  await store.sendTaskMessage(content, images, files)
}

function handleStop() {
  store.stopGeneration()
}
```

**Step 4: 让组件只关心展示，不再携带请求逻辑**

保持 `ChatInput.vue` 和 `ChatMessages.vue` 只负责 emit 输入，不感知 API 细节。`ChatMessages.vue` 无需改发送语义，只确认继续通过 `emit('send', suggestion)` 触发 store 主链路即可。

**Step 5: 标记旧 `sendMessage()` / `sendChatRequest()` 为待移除**

先让 `packages/frontend/src/stores/chat.ts` 的旧 `sendMessage()` 停止被外部使用，再在后续任务中删除 `packages/frontend/src/api/ai.ts` 调用路径。

**Step 6: 手动验证主链路**

Run:

```bash
pnpm --filter @ai-tool-chat/frontend dev
```

Expected:
- 首轮纯文本消息可以正常发送
- 带图片或文件时，后端可以收到包含本次用户消息的 `messages`
- 页面不再出现“旧 API”和“新 API”两套行为分叉

**Step 7: Commit**

```bash
git add packages/frontend/src/stores/chat.ts packages/frontend/src/views/Chat.vue packages/frontend/src/components/ChatMessages.vue packages/frontend/src/components/ChatInput.vue packages/frontend/src/api/task.ts
git commit -m "refactor(frontend): unify chat send pipeline through task store"
```

### Task 2: 接通 Task/Step 前端状态与 StepIndicator

**Files:**
- Modify: `packages/frontend/src/stores/chat.ts`
- Modify: `packages/frontend/src/views/Chat.vue`
- Modify: `packages/frontend/src/components/StepIndicator.vue`
- Modify: `packages/frontend/src/types/task.ts`
- Modify: `packages/frontend/src/api/task.ts`

**Step 1: 扩展 Task 回调处理**

在 `packages/frontend/src/stores/chat.ts` 的 `sendTaskMessage()` 内补齐回调：

```ts
{
  onTaskStart: (task) => {
    setCurrentTask(sessionId, task)
  },
  onTaskUpdate: (task) => {
    setCurrentTask(sessionId, task)
  },
  onStepStart: (step) => {
    upsertStep(sessionId, step)
  },
  onStepComplete: (step) => {
    upsertStep(sessionId, step)
  },
  onContent: (chunk) => {
    const sessionMessages = messagesMap.value[sessionId]
    if (!sessionMessages?.[assistantIndex]) return
    sessionMessages[assistantIndex].content += chunk
    setStreamingContent(sessionId, assistantIndex, sessionMessages[assistantIndex].content)
  },
  onError: (error) => {
    sessionErrorMap.value[sessionId] = error
  },
  onComplete: (task) => {
    setCurrentTask(sessionId, task)
    clearStreamingContent()
    saveToStorage()
  }
}
```

**Step 2: 为 `step error` 增加前端消费**

在 `packages/frontend/src/api/task.ts` 中补充：

```ts
else if (stepEvent === 'error') {
  callbacks.onStepComplete?.(step)
}
```

或者新增 `onStepError` 回调，更清晰。

**Step 3: 将 StepIndicator 接入页面**

在 `packages/frontend/src/views/Chat.vue` 模板中加入：

```vue
<StepIndicator
  :task="store.getCurrentTask(store.currentSessionId)"
  :steps="store.getSteps(store.currentSessionId)"
/>
```

推荐放在 `ChatInput` 上方。

**Step 4: 在 Store 中暴露查询方法**

在 `packages/frontend/src/stores/chat.ts` 增加：

```ts
function getCurrentTask(sessionId: string): Task | null {
  return currentTaskMap.value[sessionId] ?? null
}

function getSteps(sessionId: string): Step[] {
  return stepMap.value[sessionId] ?? []
}
```

**Step 5: 修正 StepIndicator 的模型显示来源**

当前 `StepIndicator.vue` 假设 `step.output.model` 存在，但后端并未稳定返回。先改为：
- 优先显示 `task.metadata?.model`
- 其次显示 `step.name`
- 最后回退到 `AI 模型`

**Step 6: 手动验证**

Run:

```bash
pnpm --filter @ai-tool-chat/frontend dev
```

Expected:
- 输入消息后，界面出现步骤面板
- 能看到 `分析 -> 执行 -> 生成` 的步骤变化
- 任务失败时步骤状态和消息错误展示一致

**Step 7: Commit**

```bash
git add packages/frontend/src/stores/chat.ts packages/frontend/src/views/Chat.vue packages/frontend/src/components/StepIndicator.vue packages/frontend/src/types/task.ts packages/frontend/src/api/task.ts
git commit -m "feat(frontend): surface task and step execution state"
```

### Task 3: 删除旧聊天 API 路径，消除双源逻辑

**Files:**
- Modify: `packages/frontend/src/stores/chat.ts`
- Delete or Deprecate: `packages/frontend/src/api/ai.ts`
- Modify: `packages/frontend/src/types/task.ts`
- Search: `packages/frontend/src/**/*.ts`

**Step 1: 删除旧 `sendMessage()` 实现**

从 `packages/frontend/src/stores/chat.ts` 中移除：
- `sendChatRequest` import
- `sendMessage()`
- `generateSmartTitle()` 中对旧 API 的直接依赖
- `buildApiMessages()`

**Step 2: 迁移标题生成策略**

短期方案：先把标题生成改成本地规则，避免再依赖旧 API。

```ts
function generateFallbackTitle(content: string): string {
  return content.trim().replace(/\s+/g, ' ').slice(0, 20) || '新对话'
}
```

在首轮成功发送后，用首条用户消息直接生成标题。

中期方案：如果仍需要 AI 标题，走同一条 `sendTaskRequest` 路径，但作为独立的 store action。

**Step 3: 全仓搜索旧 API 引用**

Run:

```bash
Get-ChildItem -Recurse packages/frontend/src -Include *.ts,*.vue | Select-String -Pattern "sendChatRequest|sendMessage\\("
```

Expected:
- 业务主链路中不再引用 `sendChatRequest`

**Step 4: 删除或保留兼容层**

如果没有剩余引用，删除 `packages/frontend/src/api/ai.ts`。
如果担心后续切换风险，先在文件头明确标记：

```ts
/**
 * @deprecated 旧聊天 API，主链路已迁移到 task.ts
 */
```

**Step 5: 手动验证**

Expected:
- 前端仅存在一套发送逻辑
- 停止、错误处理、流式展示均从 store 统一流转

**Step 6: Commit**

```bash
git add packages/frontend/src/stores/chat.ts packages/frontend/src/types/task.ts packages/frontend/src/api/ai.ts
git commit -m "refactor(frontend): remove legacy chat api path"
```

### Task 4: 统一技能路由与步骤文案来源

**Files:**
- Modify: `packages/worker/src/skills/index.ts`
- Modify: `packages/worker/src/core/taskManager.ts`
- Modify: `packages/worker/src/types/index.ts`
- Modify: `README.md`

**Step 1: 让技能选择返回结构化结果**

将 `selectSkill()` 改成返回：

```ts
interface SelectedSkill {
  skill: Skill
  model: string
  label: string
  description: string
}
```

例如：

```ts
return {
  skill: glmSkill,
  model: 'glm-4-flash',
  label: 'GLM',
  description: '调用 GLM 生成回复'
}
```

**Step 2: 让 TaskManager 使用真实选择结果**

在 `packages/worker/src/core/taskManager.ts` 中替换：

```ts
const selected = selectSkill(request, this.env)
const skill = selected.skill

const step = this.createStep(
  taskId,
  'skill',
  selected.label,
  selected.description
)
```

并在 `step.output` 或 `task.metadata` 中写入 `model`：

```ts
step.output = {
  content: fullContent,
  model: selected.model,
  skill: skill.name
}
```

**Step 3: 修正文档**

更新 `README.md` 中以下内容：
- 默认文本 skill 不再写死 DeepSeek
- 当前默认模型说明与 `selectSkill()` 保持一致
- `enableTools` 标为实验能力

**Step 4: 验证**

Run:

```bash
pnpm --filter @ai-tool-chat/worker dev
```

Expected:
- 纯文本请求时，step 描述与实际调用模型一致
- 前端步骤面板显示的模型名与后端输出一致

**Step 5: Commit**

```bash
git add packages/worker/src/skills/index.ts packages/worker/src/core/taskManager.ts packages/worker/src/types/index.ts README.md
git commit -m "refactor(worker): align skill routing metadata with runtime behavior"
```

### Task 5: 给工具能力降级定性，避免产品语义超前

**Files:**
- Modify: `packages/worker/src/core/taskManager.ts`
- Modify: `packages/worker/src/mcp/client.ts`
- Modify: `packages/worker/src/types/index.ts`
- Modify: `README.md`
- Optional Modify: `packages/frontend/src/components/ChatHeader.vue`

**Step 1: 在类型上标记工具能力状态**

在 `packages/worker/src/types/index.ts` 中补充：

```ts
export type ToolingMode = 'disabled' | 'experimental' | 'active'
```

并将其加入 task metadata。

**Step 2: 后端显式返回实验状态**

在 `packages/worker/src/core/taskManager.ts` 的 plan step 输出中加入：

```ts
step.output = {
  needsMultimodal,
  needsTools,
  toolingMode: needsTools ? 'experimental' : 'disabled'
}
```

**Step 3: 调整文档措辞**

`README.md` 不再写“支持工具调用”，改为：
- “已预留 MCP/工具能力扩展点”
- “当前未形成完整模型-工具-回填闭环”

**Step 4: 可选的前端提示**

如果界面存在工具开关，显示“实验功能”。如果没有，就不新增 UI。

**Step 5: 验证**

Expected:
- 开发者和用户看到的文档、步骤信息、实际能力保持一致

**Step 6: Commit**

```bash
git add packages/worker/src/core/taskManager.ts packages/worker/src/mcp/client.ts packages/worker/src/types/index.ts README.md packages/frontend/src/components/ChatHeader.vue
git commit -m "docs(worker): mark tool integration as experimental"
```

### Task 6: 明确 Task 生命周期边界，避免伪持久化设计

**Files:**
- Modify: `packages/worker/src/core/taskManager.ts`
- Modify: `packages/worker/src/index.ts`
- Modify: `README.md`
- Optional Create: `docs/adr/2026-03-29-task-lifecycle-boundary.md`

**Step 1: 缩小 `/stats` 的承诺范围**

在 `README.md` 和接口说明中明确：
- 当前 Task 状态为 Worker 实例内存态
- `/stats` 仅反映当前实例近似状态
- 不支持跨实例查询与恢复

**Step 2: 在代码注释中写清约束**

在 `packages/worker/src/core/taskManager.ts` 头部注释补充：

```ts
/**
 * 当前 Task 状态仅在单个 Worker 实例生命周期内有效。
 * 适用于单次 SSE 请求内的实时状态展示，不适用于持久化任务查询。
 */
```

**Step 3: 可选 ADR**

新建 `docs/adr/2026-03-29-task-lifecycle-boundary.md`，说明为什么当前不引入 Durable Object 作为任务存储：
- 当前需求只需要实时流式状态
- 引入持久化会增加复杂度
- 将来需要任务恢复或跨实例统计时再演进

**Step 4: 验证**

Expected:
- 文档与实际实现边界一致
- 后续扩展 Durable Object 时有清晰演进点

**Step 5: Commit**

```bash
git add packages/worker/src/core/taskManager.ts packages/worker/src/index.ts README.md docs/adr/2026-03-29-task-lifecycle-boundary.md
git commit -m "docs(worker): clarify task lifecycle boundary"
```

### Task 7: 回归验证与清理

**Files:**
- Modify: `package.json`
- Optional Modify: `packages/frontend/package.json`
- Optional Modify: `packages/worker/package.json`

**Step 1: 运行前端检查**

Run:

```bash
pnpm --filter @ai-tool-chat/frontend build
pnpm --filter @ai-tool-chat/frontend lint
```

Expected:
- 构建通过
- 类型检查通过
- 没有旧 API 残留导致的未使用代码或类型错误

**Step 2: 运行 Worker 检查**

Run:

```bash
pnpm --filter @ai-tool-chat/worker dev
```

Expected:
- SSE 响应正常
- 文件、多模态、纯文本三种请求都能完成 skill 路由

**Step 3: 手工回归清单**

1. 纯文本首轮对话成功返回。
2. 连续多轮对话能携带历史上下文。
3. 图片上传时能看到步骤状态变化。
4. 文件上传时不丢失本次用户输入。
5. 停止生成时会正确中断请求并重置 loading。
6. 会话切换后不会串流到其他会话。
7. README、步骤文案、实际模型选择一致。

**Step 4: Commit**

```bash
git add .
git commit -m "chore: verify unified task pipeline end to end"
```
