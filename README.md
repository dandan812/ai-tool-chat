# AI Tool Chat

一个基于 `pnpm monorepo` 的 AI 对话平台，前端使用 Vue 3，后端运行在 Cloudflare Workers。项目支持：

- 纯文本对话
- 图片理解
- 文件上传与大文件分块处理
- SSE 流式返回
- Task → Step → Skill 编排

当前仓库已经收口到单一 Task 主链路，前端通过 Store 发起请求，后端统一按任务流执行并把步骤事件实时推回 UI。

## 项目结构

```text
ai-tool-chat/
├─ packages/
│  ├─ frontend/   # Vue 3 + TypeScript + Pinia + Vite
│  └─ worker/     # Cloudflare Worker + SSE + Task/Step/Skill
├─ docs/
│  ├─ adr/
│  └─ plans/
├─ ERROR_LOG.md
├─ AGENTS.md
└─ README.md
```

## 核心能力

- 会话管理：本地持久化会话、消息、当前会话状态
- 流式回复：前端实时显示 `content` 片段
- 步骤可视化：前端消费 `task`、`step`、`error`、`complete` 事件并展示步骤状态
- 多模型路由：按文本、图片、文件自动选择 Skill
- 文件处理：支持文本类文件上传、分块、合并、分析
- 断点续传：大文件按稳定哈希分片上传，重新选择同一文件后可继续未完成分片
- 模型兜底：不同环境变量组合下自动回退到可用模型

## 技术栈

### 前端

- Vue 3
- TypeScript
- Pinia
- Vue Router
- Vite
- Markdown-It

### 后端

- Cloudflare Workers
- Wrangler
- SSE
- Durable Objects（分片上传）

## 架构说明

### 前端主链路

前端已经统一到单一发送入口：

`UI -> ChatStore -> sendTaskRequest -> Worker`

核心文件：

- [packages/frontend/src/stores/chat.ts](C:/Users/hulian/Desktop/huliang/ai-tool-chat/packages/frontend/src/stores/chat.ts)
- [packages/frontend/src/api/task.ts](C:/Users/hulian/Desktop/huliang/ai-tool-chat/packages/frontend/src/api/task.ts)
- [packages/frontend/src/views/Chat.vue](C:/Users/hulian/Desktop/huliang/ai-tool-chat/packages/frontend/src/views/Chat.vue)

当前前端会维护：

- 会话列表
- 消息列表
- 当前任务
- 当前步骤
- 流式内容
- 中断控制

### 后端执行模型

后端采用 `Task -> Step -> Skill` 三层结构：

1. `Task`：一次聊天请求的生命周期
2. `Step`：`plan`、`skill`、`respond`
3. `Skill`：具体能力模块

核心文件：

- [packages/worker/src/core/taskManager.ts](C:/Users/hulian/Desktop/huliang/ai-tool-chat/packages/worker/src/core/taskManager.ts)
- [packages/worker/src/skills/index.ts](C:/Users/hulian/Desktop/huliang/ai-tool-chat/packages/worker/src/skills/index.ts)
- [packages/worker/src/index.ts](C:/Users/hulian/Desktop/huliang/ai-tool-chat/packages/worker/src/index.ts)

## 当前模型路由

### 纯文本

- 默认文本模型统一由 `DEFAULT_MODEL` 控制
- `textSkill`、文件分析里的文本兜底和任务路由都会读取同一个默认模型解析逻辑
- 如果未设置 `DEFAULT_MODEL`，系统会按已配置的供应商 Key 自动回退到内置默认型号

### 图片理解

- 默认图片模型统一由 `DEFAULT_MULTIMODAL_MODEL` 控制
- 当前多模态默认值：`qwen3.5-plus`

### 文件处理

- 当前文件处理主链路：`fileSkill`
- 文件分析会跟随当前默认文本模型路由，不再硬绑定 `GLM_API_KEY`
- 前端文本文件统一走分片上传，聊天请求只携带 `fileId/fileName/fileHash` 等文件引用
- 后端在 Durable Object 中保存上传状态和合并后的正文，同一文件重复上传只会补传缺失分片
- 上传后的服务端文件默认保留 `24 小时`，过期后会在读取链路中按失效文件处理

## API 事件

Worker 流式返回 SSE，前端目前消费这些事件：

- `task`
- `step`
- `content`
- `error`
- `complete`

主要接口：

- `POST /`
- `POST /chat`
- `POST /upload/chunk`
- `POST /upload/complete`
- `GET /upload/status`
- `GET /health`
- `GET /stats`

## 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 配置本地 Worker 环境变量

参考示例文件：

- [packages/worker/.dev.vars.example](C:/Users/hulian/Desktop/huliang/ai-tool-chat/packages/worker/.dev.vars.example)

本地通常至少需要一个可用模型 Key：

```bash
DEFAULT_MODEL=qwen3.5-flash-2026-02-23
DEFAULT_MULTIMODAL_MODEL=qwen3.5-plus
QWEN_API_KEY=your_qwen_key
```

可选变量：

- `GLM_API_KEY`
- `QWEN_API_KEY`
- `OPENAI_API_KEY`
- `DEEPSEEK_API_KEY`
- `DEFAULT_MODEL`
- `DEFAULT_MULTIMODAL_MODEL`

### 3. 启动本地开发服务

启动前端：

```bash
pnpm --filter @ai-tool-chat/frontend dev
```

启动 Worker：

```bash
pnpm --filter @ai-tool-chat/worker dev
```

默认地址：

- 前端：[http://localhost:5173](http://localhost:5173)
- Worker：[http://127.0.0.1:8787](http://127.0.0.1:8787)

## 常用命令

### 根目录

```bash
pnpm lint
pnpm format
pnpm build
pnpm build:frontend
pnpm deploy:worker
```

### 前端

```bash
pnpm --filter @ai-tool-chat/frontend dev
pnpm --filter @ai-tool-chat/frontend build
pnpm --filter @ai-tool-chat/frontend preview
pnpm --filter @ai-tool-chat/frontend lint
pnpm --filter @ai-tool-chat/frontend format
```

### Worker

```bash
pnpm --filter @ai-tool-chat/worker dev
pnpm --filter @ai-tool-chat/worker deploy
```

## 部署

项目当前按下面的方式部署：

- 前端：Cloudflare Pages
- 后端：Cloudflare Workers
- CI/CD：GitHub Actions

生产地址：

- 前端：[https://i-tool-chat.store](https://i-tool-chat.store)
- API：[https://api.i-tool-chat.store](https://api.i-tool-chat.store)

## 设计边界

### 工具调用

`enableTools` 当前是实验能力标记，不代表完整工具链已经闭环。仓库里已经预留 MCP 相关结构，但目前仍以普通聊天主链路为主。

### Task 生命周期

Task 状态当前保存在 Worker 实例内存里，适用于单次请求过程中的实时展示，不承诺：

- 跨实例一致性
- 长期任务持久化查询
- 跨实例任务恢复

详细说明见：

- [docs/adr/2026-03-29-task-lifecycle-boundary.md](C:/Users/hulian/Desktop/huliang/ai-tool-chat/docs/adr/2026-03-29-task-lifecycle-boundary.md)

## 相关文档

- [AGENTS.md](C:/Users/hulian/Desktop/huliang/ai-tool-chat/AGENTS.md)
- [ERROR_LOG.md](C:/Users/hulian/Desktop/huliang/ai-tool-chat/ERROR_LOG.md)
- [docs/plans/2026-03-29-task-pipeline-unification.md](C:/Users/hulian/Desktop/huliang/ai-tool-chat/docs/plans/2026-03-29-task-pipeline-unification.md)

## 贡献

```bash
git checkout -b feature/your-feature
git commit -m "feat: your change"
git push origin feature/your-feature
```

## 许可证

MIT
