# 后端代码学习指南

> 本指南专为初学者设计，从请求入口开始，逐步深入后端核心逻辑。

## 一、首先，你需要知道的 5 个概念

### 1. **Worker**（工作进程）
后端跑在 Cloudflare Workers 上。Worker 就像一个云端的 Node.js 函数，它接收 HTTP 请求，处理业务逻辑，返回响应。

### 2. **Task / Step / Skill**（任务 / 步骤 / 技能）
想象一次聊天就是一个 **Task**（任务）：

```
一次用户提问 = Task
  ├─ Step 1: 理解消息内容（准备）
  ├─ Step 2: 调用合适的 Model（执行）
  ├─ Step 3: 返回流式内容（响应）
  └─ Step 4: 标记完成
```

**Skill** 是技能，每个技能处理某一类请求：
- `text-chat`：纯文本对话
- `multimodal-chat`：图片 + 文本对话
- `file-chat`：分析文件

### 3. **Stream 和 SSE**（流式数据）
用户发来的消息不是一次性返回答案，而是一个字一个字地返回（就像 ChatGPT 的界面）。

前端通过 SSE（Server-Sent Events）接收流式事件，每个事件可能是：
- `step` 事件：告诉前端"我开始执行第 2 步了"
- `content` 事件：返回生成的文字
- `error` 事件：出错了

### 4. **Provider**（提供程序）
`Provider` 是具体调用 AI 模型的类。项目中有：
- `textProvider`：调用文本模型（比如 Qwen）
- `multimodalProvider`：调用支持图片的模型

### 5. **Durable Object 和 R2**
- **Durable Object**：一个持久化的内存对象，存储上传文件的进度
- **R2**：类似 S3 的文件存储服务，存放最终的文件内容

---

## 二、请求来了之后会发生什么？

### 整个流程地图

```
用户发来消息（前端 POST）
         ↓
    index.ts（路由分发）
         ↓
chatHandlers.ts（验证 + 创建 Task）
         ↓
  TaskManager（创建任务管理器）
         ↓
TaskStepRunner（逐步执行任务）
         ↓
  Skill Router（选择对应的技能）
         ↓
Provider（调用 AI 模型）
         ↓
    SSE 流式返回给前端
```

---

## 三、让我们一层一层看代码

### 先认识当前的目录分层

现在 `packages/worker/src` 里和主链路最相关的目录大致分成这几组：

- `handlers/`：HTTP 路由入口，负责接请求和返回响应
- `core/`：Task 生命周期、步骤编排、状态存储
- `skills/`：按输入类型组织的业务技能
- `providers/`：实际调用模型接口的适配层
- `retrieval/rag/`：代码 RAG 检索与片段选择
- `retrieval/text/`：长文本切块、建索引、文本检索
- `model/`：默认模型和模型选择逻辑
- `upload/`：分片上传、Durable Object、R2 合并
- `infrastructure/`：日志、中间件、SSE、可观测性等基础设施

理解这个分层后，再顺着“入口 -> 编排 -> Skill -> Provider -> 上传/检索”的顺序看，会更容易。

### 第 1 层：入口点（`index.ts`）

```typescript
// packages/worker/src/index.ts

// 客户端发来的请求首先到这里
async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  // 根据 URL 路径分发请求
  switch (url.pathname) {
    case '/chat':
      return handleChatRequest(request, env);  // 聊天请求
    case '/upload/chunk':
      return handleUploadChunk(request, env);  // 文件上传
    // ... 其他路由
  }
}

// 中间件包装：为每个请求自动加上 CORS、错误处理、验证、日志
const app = compose(
  withCORS,         // 跨域
  withErrorHandler, // 统一错误处理
  withValidation,   // 请求验证
  withLogging       // 记录日志
)(handleRequest);
```

**学习要点**：初学者先看这里，理解"请求是怎样被分发的"。

### 第 2 层：聊天处理（`chatHandlers.ts`）

```typescript
// packages/worker/src/handlers/chatHandlers.ts

export async function handleChatRequest(request: Request, env: Env): Promise<Response> {
  // 1. 解析和验证请求体
  const body = await safeJSONParse<ChatRequest>(request);
  
  if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
    throw new ValidationError('Messages are required');
  }

  const { messages, stream = true, images, files, enableTools } = body;

  // 2. 创建任务管理器
  const taskManager = new TaskManager(env);
  const task = taskManager.createTask(body);

  // 3. 区分流式和非流式处理
  if (!stream) {
    // 全部收集后一次返回
    return handleNonStreamRequest(taskManager, task.id, body);
  }

  // 流式处理：一字一字返回
  return handleStreamRequest(taskManager, task.id, body);
}
```

在 `handleStreamRequest` 函数中：

```typescript
function handleStreamRequest(
  taskManager: TaskManager,
  taskId: string,
  request: ChatRequest,
): Response {
  // 用 TransformStream 把异步数据转换成 HTTP 流
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const executeTask = async () => {
    try {
      // 逐个处理任务产生的事件
      for await (const event of taskManager.executeTask(taskId, request)) {
        // 每个事件都转成 SSE 格式发给客户端
        const data = `data: ${serializeSSEEvent(event)}\n\n`;
        await writer.write(encoder.encode(data));
      }
      
      // 发送完成标记
      await writer.write(encoder.encode('data: [DONE]\n\n'));
    } catch (error) {
      // 错误也以 SSE 事件形式返回
      const errorEvent = { type: 'error', data: { error: String(error) } };
      await writer.write(encoder.encode(`data: ${serializeSSEEvent(errorEvent)}\n\n`));
    } finally {
      await writer.close();
    }
  };

  // 启动协程，立即返回响应流
  void executeTask();

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
```

**学习要点**：
- 为什么要分行为流式和非流式？
- SSE 是怎样工作的？（注意 `data: ` 前缀）
- 为什么用 `TransformStream`？

### 第 3 层：任务管理器（`TaskManager`）

```typescript
// packages/worker/src/core/taskManager.ts

export class TaskManager {
  private readonly taskStore: TaskStore;      // 存储所有任务
  private readonly stepRunner: TaskStepRunner; // 执行任务步骤

  // 创建一个新的任务
  createTask(request: ChatRequest): Task {
    return this.taskStore.createTask(request);
  }

  // 执行任务，每一步都生成一个事件
  async *executeTask(
    taskId: string,
    request: ChatRequest,
  ): AsyncIterable<TaskStreamEvent> {
    const task = this.taskStore.prepareTaskForExecution(taskId);

    // 第一步：发送"任务已开始"事件
    yield { type: 'task', data: { task, event: 'started' } };

    // 设置超时控制（防止任务卡住）
    const timeoutId = startTaskTimeout(this.taskStore, taskId, TASK_TIMEOUT_MS);

    try {
      // 关键！让 StepRunner 逐步执行任务，每一步都 yield 出事件
      yield* this.stepRunner.run(task, request);

      // 任务完成
      this.taskStore.markCompleted(taskId);
    } catch (error) {
      // 任务失败
      this.taskStore.markFailed(taskId, String(error));
      yield { type: 'error', data: { error: String(error) } };
    }
  }
}
```

**学习要点**：
- `async *` 是什么？（异步生成器）
- `yield` 是怎样把每一步的结果送出去的？
- 为什么要分 `taskStore` 和 `stepRunner` 两个类？

### 第 4 层：步骤执行器（`TaskStepRunner`）

```typescript
// packages/worker/src/core/taskStepRunner.ts

export class TaskStepRunner {
  async *run(task: Task, request: ChatRequest): AsyncIterable<TaskStreamEvent> {
    // 第 1 步：初始化任务状态
    const step1 = this.initializeTask(task, request);
    yield { type: 'step', data: step1 };

    // 第 2 步：根据请求类型选择合适的 Skill
    const skill = this.selectSkill(request);
    yield { type: 'step', data: { name: 'select_skill', skill } };

    // 第 3 步：执行 Skill
    yield* skill.execute(task, request);

    // 第 4 步：标记步骤完成
    yield { type: 'step', data: { name: 'complete' } };
  }
}
```

**学习要点**：
- Task 的整个生命周期是怎样的？
- Skill 是在哪里被选择的？

### 第 5 层：技能执行（Skill 实现）

项目中有 3 个 Skill，我们以 `textSkill + textProvider` 这条链路为例：

```typescript
// packages/worker/src/skills/textSkill.ts

export const textSkill: Skill = {
  name: 'text-chat',
  type: 'text',
  async *execute(input, context) {
    const providerConfig = resolveTextProvider(input, context);
    if (!providerConfig) {
      throw new Error('No available text provider');
    }

    yield {
      type: 'step',
      step: {
        name: 'text_generation',
        status: 'running',
        message: `正在使用 ${providerConfig.model} 生成回复`,
      },
    };

    yield* executeTextProviderStream(
      providerConfig,
      input.messages,
      typeof input.temperature === 'number' ? input.temperature : 0.7,
    );
  },
};
```

真正发请求给模型的是 Provider：

```typescript
// packages/worker/src/providers/textProvider.ts

export async function* executeTextProviderStream(
  providerConfig: TextProviderConfig,
  messages: Message[],
  temperature: number,
): AsyncIterable<SkillStreamChunk> {
  yield* executeChatCompletionStream({
    provider: providerConfig.provider,
    model: providerConfig.model,
    url: providerConfig.url,
    apiKey: providerConfig.apiKey,
    body: {
      model: providerConfig.model,
      messages,
      stream: true,
      temperature,
    },
  });
}
```

**学习要点**：
- Skill 为什么只保留“编排”而不直接写 fetch？
- Provider 为什么适合做成“模型适配层”？
- 流式响应是怎样从 Provider 一路传回前端的？

---

## 四、核心数据结构

### Task（任务）

```typescript
interface Task {
  id: string;              // 唯一 ID
  status: 'pending' | 'running' | 'completed' | 'failed';
  messages: Message[];     // 用户的消息历史
  metadata: {
    model?: string;        // 使用的模型
    skill?: string;        // 使用的技能
    fileId?: string;       // 上传的文件 ID（如果有）
  };
  createdAt: number;       // 创建时间
  completedAt?: number;    // 完成时间
}
```

### TaskStreamEvent（事件类型）

```typescript
type TaskStreamEvent =
  | { type: 'task'; data: { task: Task; event: string } }
  | { type: 'step'; data: { name: string; [key: string]: any } }
  | { type: 'content'; data: { content: string; status: string } }
  | { type: 'error'; data: { error: string } };
```

前端接收这些事件，实时更新界面：
- `task` 事件：更新整体任务状态
- `step` 事件：展示"正在做第 X 步"
- `content` 事件：把文字逐字显示在聊天框中
- `error` 事件：展示错误信息

---

## 五、文件上传链路（如果你想进阶）

如果任务涉及文件分析：

```
1. 前端分片上传（/upload/chunk）
   ↓
2. Durable Object 存储上传状态
   ↓
3. 前端通知合并（/upload/complete）
   ↓
4. Worker 把文件内容写入 R2
   ↓
5. 前端发聊天请求，带上 fileId
   ↓
6. Provider 从 R2 读取文件，按块搜索相关内容
   ↓
7. 把相关块和问题一起发给 AI 模型
```

学习路径：
1. 先学上面的 5 层流程（必须）
2. 再看 `uploadHandlers.ts` 和 `upload/chunkStorage.ts`
3. 再看 `skills/fileSkill.ts`、`skills/fileSkillCodeProcessing.ts`、`skills/fileSkillTextProcessing.ts`
4. 如果想理解检索细节，再看 `retrieval/rag/` 和 `retrieval/text/`

---

## 六、推荐的代码阅读顺序

### Day 1（理解骨架）
- [ ] `packages/worker/src/index.ts` - 了解路由和中间件
- [ ] `packages/worker/src/handlers/chatHandlers.ts` - 了解请求处理
- [ ] 运行一次聊天请求，看看 `worker-dev.log` 里有什么日志

### Day 2（理解编排）
- [ ] `packages/worker/src/core/taskManager.ts` - 任务管理器
- [ ] `packages/worker/src/core/taskStepRunner.ts` - 步骤执行
- [ ] `packages/worker/src/types.ts` - 数据结构定义

### Day 3（理解实现）
- [ ] `packages/worker/src/skills/textSkill.ts` - 文本 Skill
- [ ] `packages/worker/src/providers/textProvider.ts` - 文本 Provider
- [ ] `packages/worker/src/providers/multimodalProvider.ts` - 多模态 Provider
- [ ] 在本地打个断点，单步追踪一个请求

### Day 4（进阶）
- [ ] `packages/worker/src/handlers/uploadHandlers.ts` - 文件上传
- [ ] `packages/worker/src/upload/chunkStorage.ts` - 分片存储入口
- [ ] `packages/worker/src/upload/chunkStorageService.ts` - 分片存储核心逻辑
- [ ] `packages/worker/src/retrieval/rag/ragRetriever.ts` - 代码 RAG 检索
- [ ] `packages/worker/src/retrieval/text/textRetriever.ts` - 文本检索
- [ ] `packages/worker/src/mcp/client.ts` - MCP 客户端（工具调用）

---

## 七、常见问题

### Q：为什么用异步生成器（async *）？
**A**：因为我们需要在执行过程中一步一步地发送事件。如果改成普通函数，要么一次性返回所有事件，要么要等着。异步生成器让我们能"懒加载"事件——什么时候需要什么时候再生成。

### Q：为什么 Task 要存在 TaskStore 里？
**A**：因为 Worker 是无状态的。客户端发来第二个请求时，可能分配到不同的 Worker 实例。TaskStore 让我们在单个 Worker 实例内部记录所有 Task 的状态，用于查询和排障。

注意：这不是持久化存储，Worker 重启后 Task 会丢失。如果需要长期保存任务历史，要用 Durable Objects 或数据库。

### Q：Provider 和 Skill 有什么区别？
**A**：
- **Skill**：包装了完整的任务逻辑（初始化 → 调用 Provider → 处理结果）
- **Provider**：具体调用 AI 模型的类，掌握 API Key、请求格式、错误处理

一个 Skill 可能会调用多个 Provider。

### Q：为什么要分 textProvider 和 multimodalProvider？
**A**：因为它们调用不同的模型，模型的请求格式略有不同。如果混在一起，代码会有很多 `if/else`，不好维护。

### Q：流式是怎样实现的？
**A**：
1. Worker 不是一次性计算出答案再返回
2. 而是建立一个 HTTP 连接，用 SSE 格式把数据分批发给客户端
3. 客户端收到每一批数据（比如一个字）就立即更新界面
4. 最后发 `[DONE]` 信号表示结束

这样用户能看到"打字"的过程，体验更好。

### Q：如何给任务加 log？
**A**：用 `logger` 工具：

```typescript
import { logger } from '../infrastructure/logger';

logger.info('任务开始', { taskId, model, skill });
logger.error('任务失败', { taskId, error });
```

这些 log 会输出到 `worker-dev.log`，并且自动包含结构化信息，好用于排障。

---

## 八、本地调试技巧

### 打开实时日志
```bash
tail -f worker-dev.log
```

### 在浏览器调试前端
打开 DevTools → Network，看 `/chat` 请求的 Response。会看到一个一个的 SSE 事件：

```
data: {"type":"task","data":{"task":{"id":"xxx","status":"running"},"event":"started"}}

data: {"type":"step","data":{"name":"start_text_generation","model":"qwen3.5-flash"}}

data: {"type":"content","data":{"content":"你","status":"streaming"}}

data: {"type":"content","data":{"content":"好","status":"streaming"}}
```

### 单步调试
在 Worker 代码中加入这样的日志：

```typescript
logger.debug('正在调用模型', { taskId, messages });
```

然后看 log 输出。

---

## 九、进阶阅读

当你理解了上面的 5 层流程后，可以看这些文档：

- [`AGENTS.md`](../AGENTS.md) - 工具调用（MCP）
- [`docs/reference/ERROR_LOG.md`](./reference/ERROR_LOG.md) - 错误日志大全
- [`docs/plans/2026-03-29-task-pipeline-unification.md`](./plans/2026-03-29-task-pipeline-unification.md) - 任务流脑设计文档

---

## 十、学习检验清单

看完这个指南后，检查一下你是否能理解这些问题：

- [ ] 请求进来后会经过哪几个处理函数？
- [ ] Task / Step / Skill 分别是什么？
- [ ] 为什么要用异步生成器？
- [ ] TaskStore 存的是什么东西？
- [ ] 流式响应是怎样工作的？
- [ ] 前端收到的 SSE 事件有哪几种类型？
- [ ] textProvider 和 multimodalProvider 的主要区别是什么？
- [ ] 文件上传为什么要用 Durable Object？

---

## 补充：代码注释风格

项目中的注释都遵循这个原则：

```typescript
/**
 * 为初学者设计的注释，简单说明这个类干什么
 * 以及为什么要拆成这样。
 */
export class SomeClass {
  // 关键决定的原因
  private readonly field: Type;

  // 不要注释显而易见的东西
  async doSomething() {
    // 只在逻辑不直观或有陷阱的地方加注释
  }
}
```

---

祝你学习愉快！有问题欢迎在代码注释或 issues 里提。
