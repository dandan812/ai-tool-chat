# 平台代码阅读指南

更新：2026-10-16。描述当前源码；本轮整理尚未部署。

先跟完一次请求，再深入支持模块。主站运行 Node/SQLite，
`packages/worker` 是 Node 复用的业务代码，同时保留 Cloudflare 运行入口。

## 先认清职责

| 目录 | 负责什么 |
| --- | --- |
| `frontend/src/components`、`views` | 页面布局和交互 |
| `frontend/src/features/chat` | 会话、消息和本地持久化 |
| `frontend/src/features/tasks` | 观察后台任务，把事件更新到正确的消息 |
| `frontend/src/features/uploads` | 查状态、补传分片和完成上传 |
| `server/src` | HTTP 适配、SQLite、私有文件和文档解析 |
| `worker/src/handlers` | HTTP 输入、身份和业务入口 |
| `worker/src/core` | 任务生命周期、执行、输出持久化与用量 |
| `worker/src/platform` | 认证、账户额度、文件归属和租约 |
| `worker/src/skills` | 文本、图片、文件问答和受限资料研究 |
| `worker/src/providers` | 上游模型请求、SSE 解析和 token 用量 |
| `worker/src/retrieval` | 从原文选择依据，构造有预算的模型输入 |
| `worker/src/upload` | 分片状态、合并、版本校验和正文读取 |

## 第一条链：发送、生成、恢复

下面路径相对于仓库根目录。按顺序打开，每个文件先看表中函数。

| 顺序 | 文件 | 先看什么 |
| --- | --- | --- |
| 1 | `packages/frontend/src/composables/useChatComposer.ts` | `sendMessage`：解析草稿图片，提交输入 |
| 2 | `packages/frontend/src/stores/chat.ts` | 薄入口，连接会话与任务观察 |
| 3 | `packages/frontend/src/features/tasks/sessionTasks.ts` | `sendTaskMessage`、`observe`、`callbacksFor` |
| 4 | `packages/frontend/src/api/requestManager.ts` | `send` 创建任务，`resume` 只读同一任务 |
| 5 | `packages/server/src/server.mjs`、`http.mjs` | 服务配置、`/api` 转发和请求 ID |
| 6 | `packages/server/src/runtime.mjs` | 组装存储适配，分发请求，调度任务 alarm |
| 7 | `packages/worker/src/index.ts` | 路由、中间件、身份校验 |
| 8 | `packages/worker/src/handlers/taskHandlers.ts` | 输入、幂等键和文件归属校验 |
| 9 | `packages/worker/src/core/durableTask.ts` | 创建、认领、执行、取消与结算 |
| 10 | `packages/worker/src/core/taskStepRunner.ts` | `run`：选择能力、执行能力、保存结果 |
| 11 | `packages/worker/src/skills/index.ts` | 按图片、文件、文本选择能力和模型 |
| 12 | `packages/worker/src/providers/chatCompletionStream.ts` | 读取上游 SSE，处理完成、取消和用量 |

普通任务的顶层阶段是 `route → skill`。资料研究的只读工具也会产生步骤，
沿用协议中的 `mcp` 类型名；这不表示接入了外部 MCP 服务。

```text
sendTaskMessage
  → TaskRequestManager.send：固定 Idempotency-Key
  → handleTaskRequest：按用户与 key 确定任务身份
  → DurableTask.create：预留额度，写入请求，安排执行
  → DurableTask.alarm：认领任务
  → executeAndPersistTask → TaskManager → TaskStepRunner → Skill → Provider
  → TaskRepository：先持久化事件，再通知观察者
  → taskEventStream：按 after 游标推送
  → callbacksFor：找到稳定消息 ID，更新内容和步骤
```

读懂这条链后，再看：

| 问题 | 代码 |
| --- | --- |
| 事件、快照和原文来源怎样保存？ | `core/tasks/taskRepository.ts` |
| 创建、执行、终态分别保存哪些字段？ | `core/tasks/taskRecord.ts` |
| token 预算和实际用量怎样衔接？ | `core/tasks/taskUsage.ts` |
| 浏览器怎样验证事件和游标？ | `frontend/src/features/tasks/taskProtocol.ts` |
| SSE 怎样读取，文字怎样合并到一帧？ | `frontend/src/api/taskEventStream.ts`、`requestManager.ts` |
| SQLite 存在哪里？ | `server/src/sqlite-store.mjs`，按 namespace、对象 ID 和 key 存序列化值 |

这里不是每个业务对象一张关系表。Node 的 SQLite 适配沿用共享业务的键值存储和事务接口；
账户、任务与上传分别由其对象身份隔离。读数据库前先读写入它的业务模块。

## 第二条链：上传、解析、检索、引用

| 顺序 | 文件 | 先看什么 |
| --- | --- | --- |
| 1 | `packages/frontend/src/components/FileUploader.vue` | 选择文件、展示进度和上传结果 |
| 2 | `packages/frontend/src/features/uploads/controller.ts` | 查询已有分片，只补传缺片 |
| 3 | `packages/worker/src/handlers/uploadHandlers.ts` | 读取并校验 HTTP 输入 |
| 4 | `packages/worker/src/upload/uploadService.ts` | 账户配额、文件租约和上传存储协调 |
| 5 | `packages/worker/src/upload/chunkStorageService.ts` | 存片、合并、版本与元数据 |
| 6 | `packages/worker/src/upload/ownedFiles.ts` | 提问时验证文件属于当前账户 |
| 7 | `packages/worker/src/upload/uploadedFileStorage.ts` | 读取正文；文档交给运行环境解析 |
| 8 | `packages/server/src/document-extractor.mjs` | 限制解析任务与工作线程生命周期 |
| 9 | `packages/server/src/document-worker.mjs` | PDF、Word、Excel 的实际文本提取 |
| 10 | `packages/worker/src/skills/fileSkill.ts` | 读取附件后直接进入 `answerFromFiles` |
| 11 | `packages/worker/src/skills/fileAnswer.ts` | 选择问答模式，先发来源，再生成答案 |
| 12 | `packages/worker/src/retrieval/fileContext.ts` | 选择原文，限制预算，保留行号与偏移 |
| 13 | `packages/frontend/src/components/EvidenceSources.vue` | 展开并核对引用原文 |

小文件可直接使用有预算的原文；大文件按问题检索；概览使用代表性片段；
代码检索也只引用实际原文。旧的有损代码压缩和全文摘要包装已移除。
没有足够依据时结束，不额外调用模型编造答案。

显式勾选“资料研究”时改走 `skills/fileAgentSkill.ts`：
解析附件 → 最多两轮只读搜索/读取 → 基于来源回答 → 检查来源标记。
工具实现集中在 `fileAgentTools.ts`，只能访问本次已校验的附件。
来源标记检查不能证明答案的语义一定正确。

## 必须保留的边界

- **恢复查看与重新执行：** 重连读取原任务；已认领的执行中断后明确失败，避免重复计费。
- **停止查看与取消：** 关闭 SSE 不取消后台；取消需要服务端确认，部分内容仍保存。
- **账户切换：** 账户代次、观察者身份和稳定消息 ID 阻止旧响应写入新账户或其他消息。
- **文件操作：** 归属、版本与租约校验分别防止越权、旧文件引用和删除/写入竞态。
- **额度与费用：** token 额度和估算费用不等于实际账单；未知用量不能按零处理。
- **旧记录：** `plan`、`respond` 等步骤类型和既有存储字段仍可读取，不做数据迁移。

## 怎样验证自己读懂了

1. 发送问题后刷新：解释为什么 POST 不会再次执行模型。
2. 生成中停止查看，再从任务中心打开：解释观察与执行的区别。
3. 取消任务或中断服务：找到部分内容、终态和用量写入位置。
4. 上传文档并提问：从引用片段追到提取正文，解释行号代表什么。
5. 切换账户：指出旧响应在哪一层被拒绝。

本地检查用 `pnpm check`。按模块学习时，可单独运行对应的 `.test.ts`
或 Node 的 `test/*.test.mjs`。已有测试使用离线模型验证链路，不代表真实模型质量。
本轮具体改动和验证见 [精简记录](../reference/2026-10-16-code-cleanup.md)。
