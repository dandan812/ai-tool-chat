# CLAUDE.md

此文件为 Claude Code (claude.ai/code) 在此代码仓库中工作时提供指导。

## 项目概述

这是一个基于 **pnpm monorepo** 的 AI 对话平台 - 一个使用 Cloudflare Worker 后端的 Vue 3 对话式 AI 应用。该平台支持与 AI 助手进行文本和多模态（图片）交互，使用服务器发送事件（SSE）进行实时流式响应。

## Monorepo 结构

```
ai-tool-chat/
├── packages/
│   ├── frontend/     # Vue 3 + TypeScript 单页应用
│   └── worker/       # Cloudflare Worker 后端
```

## 开发命令

### 根目录
```bash
pnpm install              # 安装所有依赖
pnpm lint                 # 检查所有包
pnpm format               # 格式化所有代码
pnpm build                # 构建前端（build:frontend 的别名）
pnpm build:frontend       # 构建前端
pnpm deploy:worker        # 部署 worker 到 Cloudflare
```

### 前端包
```bash
pnpm --filter @ai-tool-chat/frontend dev      # 开发服务器 (localhost:5173)
pnpm --filter @ai-tool-chat/frontend build   # 生产构建
pnpm --filter @ai-tool-chat/frontend preview # 预览生产构建
pnpm --filter @ai-tool-chat/frontend lint    # 检查并修复
pnpm --filter @ai-tool-chat/frontend format  # 格式化代码
```

### Worker 包
```bash
pnpm --filter @ai-tool-chat/worker dev     # 本地开发服务器
pnpm --filter @ai-tool-chat/worker deploy  # 部署到 Cloudflare Workers
```

## 架构

### 前端 (Vue 3)

- **状态管理**: Pinia store (`packages/frontend/src/stores/chat.ts`) 管理会话、消息和本地存储持久化
- **API 层**: `packages/frontend/src/api/ai.ts` 处理来自 worker 的 SSE 流式响应
- **组件**: 位于 `packages/frontend/src/components/`：
  - `ChatMessages.vue` - 消息列表，带 Markdown 渲染
  - `ChatInput.vue` - 输入区域，支持文本和图片上传
  - `Sidebar.vue` - 会话管理
  - `StepIndicator.vue` - 显示 AI 处理步骤
  - `ImageUploader.vue` - 多模态支持

前端使用 localStorage 进行持久化（键名：`chat_session_list`、`chat_messages_map`、`chat_current_session_id`）。

### 后端 (Cloudflare Worker)

Worker 遵循 **Task → Step → Skill** 架构模式：

1. **Task** (`packages/worker/src/core/taskManager.ts`): 表示单个聊天请求，管理生命周期
2. **Steps** (`plan`, `skill`, `respond`): 任务执行的顺序阶段
3. **Skills** (`packages/worker/src/skills/`): 可插拔的处理模块
   - `textSkill.ts` - 纯文本 AI 对话 (DeepSeek API)
   - `multimodalSkill.ts` - 图片+文本处理 (Qwen-VL API)
   - 通过 `selectSkill()` 根据输入类型自动选择

**MCP 集成** (`packages/worker/src/mcp/`): 模型上下文协议，用于工具执行。

**流式响应**: 通过服务器发送事件（SSE）流式传输响应，事件类型：`task`、`step`、`content`、`error`、`complete`。

## API 端点

- **Worker URL**: `https://api.i-tool-chat.store` (定义于 `packages/frontend/src/api/ai.ts:28`)
- **方法**: POST
- **请求体**: `{ messages: ChatMessage[], images?: string[], files?: File[], enableTools?: boolean, temperature?: number, stream?: boolean }`
- **响应**: SSE 流，包含 JSON 事件

## 环境变量

### Worker (必需)
- `DEEPSEEK_API_KEY` - 主要 AI 提供商
- `QWEN_API_KEY` - 多模态支持（可选）

### 前端 (可选)
- `VITE_API_URL` - API 服务器地址（默认为 worker URL）

## 代码规范

- **TypeScript**: 全局启用严格模式
- **提交信息**: 约定式提交 (`feat:`、`fix:`、`docs:` 等)
- **组件命名**: Vue 组件使用 PascalCase
- **文件组织**: 按功能领域分组

## 部署

前端和 worker 在推送到 `main` 分支时通过 GitHub Actions 自动部署到 Cloudflare。

- **前端**: Cloudflare Pages（构建命令：`pnpm install && pnpm build`，输出：`packages/frontend/dist`）
- **Worker**: Cloudflare Workers（通过 `wrangler deploy`）

## 常见问题

- **网络错误**: 通常表示 worker 未部署或缺少 `DEEPSEEK_API_KEY` 环境变量
- **浏览器缓存**: 部署后需要强制刷新（Ctrl+Shift+R），必要时清除 Cloudflare 缓存

详细故障排查请参阅 `ERROR_LOG.md`。
