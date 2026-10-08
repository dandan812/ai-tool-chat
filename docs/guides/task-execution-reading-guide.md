# 任务执行链路：阅读与面试指南

日期：2026-09-30。针对当前本地代码；不代表线上已经发布。

## 先掌握三个名词

| 名词 | 在这个项目中的含义 | 不负责什么 |
| --- | --- | --- |
| Task | 用户提交的一次请求，包括状态、步骤和最终结果 | 不等于一个会自动规划的 Agent |
| Step | 一次任务中的处理阶段，记录状态、时间和进度 | 不自动获得独立重试或执行恢复能力 |
| Skill | 处理一种输入的能力模块，例如文本、图片、文件 | 不负责账户、持久任务调度或页面渲染 |

当前新任务只有两个顶层步骤：

```text
route：根据输入选择处理能力
  |
skill：执行所选能力，并持续发出内容、进度、来源和用量
```

文件 Skill 内部还会读取文件、检索证据、调用模型。这些工作通过同一个
Step 的 progress 展示，不是三个可以独立恢复的工作流节点。

## 按这个顺序读，不要从最长的文件开始

1. `packages/worker/src/core/taskManager.ts`
   先读 `executeTask()`：启动任务，执行步骤，处理完成或失败。
2. `packages/worker/src/core/taskStepRunner.ts`
   先只读 `run()`，它就是本轮整理后的主流程。
3. `packages/worker/src/skills/index.ts`
   读 `selectSkill()`，了解输入怎样选到文本、图片或文件处理。
4. `packages/worker/src/skills/fileSkill.ts`
   了解文件处理的分流，再按需要读文本或代码检索实现。
5. `packages/worker/src/core/durableTask.ts`
   最后再读持久化、事件序号、预算和取消；它们不属于 Skill 的职责。
6. `packages/frontend/src/api/requestManager.ts`
   看创建请求与事件读取怎样分开。
7. `packages/frontend/src/stores/chat.ts`
   这是薄入口；继续读 `features/tasks/sessionTasks.ts` 中的
   `callbacksFor()`，看事件怎样更新消息和步骤。

## 主流程只做三件事

```typescript
const selectedSkill = yield* this.routeRequest(task.id, request);
const content = yield* this.executeSkill(task.id, request, selectedSkill);
this.taskStore.setResult(task.id, content);
```

- `routeRequest()` 选择处理能力，并报告路由步骤的开始、完成或错误。
- `executeSkill()` 真正执行，转发内容、证据来源、进度与用量。
- `setResult()` 保存最终结果，不再制造一个没有实际生成工作的 respond 步骤。

不是“先规划，再调用一次模型，最后再调用一次模型生成”。普通对话和当前
文件问答路径至多发起一次生成调用；依据不足时不调用模型，
路由和构建文件上下文也不调用模型。

## 看懂异步生成器

这里保留异步生成器是为了沿用已有流式实现，而不是增加新的框架。

```typescript
yield { type: 'content', data: { content: '一小段回答' } };
```

`yield` 把一条事件交给外层，外层处理后再继续执行。

```typescript
yield* this.executeSkill(task.id, request, selectedSkill);
```

`yield*` 把另一个生成器的事件依次转发出来，并在它结束时取得返回值。
这里得到的返回值是拼接后的完整回答。

```typescript
for await (const chunk of skillExecution) {
  // 每次处理一条异步到达的 Skill 事件。
}
```

`for await` 持续读取异步事件，而不是一次性等全部内容生成完。

### 为什么收到 complete 后还继续读？

模型 Provider 在返回完成标记之后，可能还需要结算并报告 usage。
因此 runner 只记住 `receivedComplete = true`，不会在这里 `break`。
整个 Skill 流结束且结算没有失败，才把 Step 标记为完成。

## 进度怎样到达页面

```text
文件 Skill 发出 progress
  -> TaskStepRunner 更新同一个 Step 的 description/progress
  -> 发出 step / progress 事件
  -> DurableTask 保存带序号的事件
  -> 前端按游标读取并去重
  -> onStepProgress
  -> Pinia upsertStep
  -> StepIndicator 显示最新描述
```

`current/total` 只表示该处理阶段的计数，不表示整条任务或模型生成的精确百分比。

目前持久任务的浏览器链路是 HTTP 事件轮询；模型 Provider 读取上游 SSE。
不要把“模型流式响应”与“浏览器通过 SSE 接收持久任务”混为一谈。

## 错误由哪层负责

- Skill：报告输入处理或 Provider 的错误。
- TaskStepRunner：标记正在运行的步骤失败，补齐结束时间，并继续抛出原错误。
- TaskManager：标记任务失败，输出统一的任务错误事件。
- DurableTask：保存已收到的内容和终态，处理预算、取消与结算。

不要把错误先转换为 `{ success: false }`，再在外层重建同一个错误。
这会增加理解成本，也容易丢失预算错误码或原始堆栈。

刷新页面时只恢复查看同一任务。后台执行实例丢失后的自动重算可能重复
计费，所以现有实现保留部分输出并明确失败，不承诺从某个 token 无缝续算。

## 哪些测试证明了什么

| 测试 | 证明的行为 |
| --- | --- |
| `taskStepRunner.test.ts` | 路由与执行、进度顺序、不复制全文、完整结束、错误和取消 |
| `durableTask.test.ts` | 持久化回放、权限边界、取消、预算、中断不自动重发模型请求 |
| `requestManager.test.ts` | progress 不冒充 start、按事件序号去重、失败不报告完成 |
| `taskPresentation.test.ts` | 新路由标签、实际能力名称与旧任务类型兼容 |
| `chunk.test.ts` | 账户隔离后的上传缓存测试前提，旧匿名记录不被误删 |

在仓库根目录运行：

```powershell
pnpm --filter @ai-tool-chat/worker exec vitest run src/core/taskStepRunner.test.ts src/core/taskManager.test.ts src/core/durableTask.test.ts src/skills/fileEvidence.test.ts src/handlers/taskHandlers.test.ts src/providers/chatCompletionStream.test.ts
pnpm --filter @ai-tool-chat/frontend test
pnpm --filter @ai-tool-chat/worker typecheck
pnpm --filter @ai-tool-chat/frontend build
```

执行离线性能基准时，指定报告路径：

```powershell
$env:TASK_BENCHMARK_REPORT = Join-Path $env:TEMP 'task-execution-benchmark.json'
pnpm --filter @ai-tool-chat/worker exec vitest run src/core/taskExecution.performance.test.ts
Remove-Item Env:TASK_BENCHMARK_REPORT
```

不指定环境变量时，性能基准默认跳过，不把易波动的耗时阈值当作单元测试。
基准使用固定输入，预热 20 次、采样 100 次，不访问网络。
测的是执行与原始事件序列化，不是线上响应时间，也不是浏览器实际流量。

## 面试可以这样讲

> 我没有为普通对话引入通用工作流引擎，而是保留任务生命周期与能力路由，
> 将固定但没有实际处理的规划、响应包装阶段改为路由与执行。
> 文件读取、检索、生成的实际进度沿统一事件链更新到前端；
> 同时补充错误、取消、事件回放和模型用量结算的回归测试。

### 需要能回答的追问

1. 为什么不是直接调用模型？
   因为请求还涉及输入分流、状态展示、预算、取消和持久记录；
   但这些职责不需要都塞进 Skill。
2. 为什么不是工作流引擎？
   当前步骤不需要独立调度或检查点重试，复杂引擎会增加维护成本。
3. 断网之后是否重新调用模型？
   恢复查看不会。执行实例真正中断后，明确失败，由用户决定是否新建任务。
4. 性能优化了多少？
   上一次单条执行链简化的固定样本事件体积减少，本轮平台业务重写的
   事件和回放字节不变，均未证明回答提速。不能跨轮复用基准百分比，
   更不能推算模型响应时间、DO 存储费用或网络流量。
5. 是否支持旧历史？
   新任务产生 route/skill；旧的 plan/respond 等类型仍可读取和显示。

## 整个平台

任务链路是整体业务重写的一部分，其他模块见
[整个平台阅读指南](./platform-reading-guide.md)。后续优化文件检索质量时，
应单独固定数据集与评估指标；优化持久任务性能时，另测 DO 读写和端到端耗时，
不沿用 TaskManager 微基准作为生产结论。
