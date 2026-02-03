# AI Tool Chat Platform

AI 对话与工具平台，基于 Vue 3 构建的现代化前端应用，支持多种 AI 模型和先进的 UI/UX 设计系统。

## 功能特性

- 🤖 **多模型支持**：集成 Kimi K2.5、GLM 等多种顶级 AI 模型
- 💬 **AI 智能对话**：与 AI 助手进行实时对话，获取智能回答
- � **对话历史管理**：查看、切换和删除对话历史，支持本地持久化
- 🌙 **主题切换**：支持浅色和深色主题，适应不同使用场景
- 📱 **响应式设计**：适配不同屏幕尺寸，在手机和电脑上都有良好表现
- ⚙️ **助手人设设置**：自定义 AI 助手的系统提示词，调整助手行为
- 🖼️ **多模态支持**：支持图片上传和处理，与 AI 进行图文交互
- 📝 **Markdown 渲染**：支持 Markdown 格式的消息内容，包括代码块高亮
- 📋 **代码复制**：一键复制代码块内容，方便使用
- 🔥 **热门提问**：提供热门问题推荐，快速开始对话
- 📊 **步骤指示器**：显示 AI 处理过程的详细步骤
- 🔄 **自动滚动**：智能自动滚动到最新消息，提升阅读体验
- 🛠️ **MCP 协议支持**：实现 Model Context Protocol，内置代码执行和网页搜索工具
- 🧠 **智能技能路由**：根据输入内容（文本/图片）自动选择最佳处理技能
- 🎨 **反主流美学设计**：基于 ui-ux-pro-max 技能的现代化设计系统
- 🚀 **高性能渲染**：优化的渲染性能，流畅的用户体验
- 🔒 **数据安全**：对话数据存储在本地，确保数据安全和隐私保护

## 技术栈

### 前端

- **框架**：Vue 3 + TypeScript
- **状态管理**：Pinia
- **路由**：Vue Router
- **构建工具**：Vite 7
- **代码规范**：ESLint + Prettier
- **样式**：原生 CSS + CSS 变量 + ui-ux-pro-max 设计系统
- **Markdown 渲染**：Markdown-It
- **多模态支持**：FileReader API + Canvas API
- **性能优化**：组件懒加载、虚拟列表、代码分割

### 设计系统

- **ui-ux-pro-max**：集成先进的设计系统，提供反主流美学设计
- **响应式布局**：自适应各种屏幕尺寸
- **主题系统**：支持自定义主题和动态主题切换
- **无障碍设计**：考虑键盘导航和屏幕阅读器支持

### 后端

- **Cloudflare Workers**：无服务器后端，处理 API 请求

### 开发工具

- **包管理**：pnpm
- **Git 钩子**：Husky
- **CI/CD**：GitHub Actions

## 项目结构

```
ai-tool-chat/
├── packages/
│   ├── frontend/         # 前端应用
│   │   ├── src/
│   │   │   ├── api/      # API 调用
│   │   │   ├── components/  # Vue 组件
│   │   │   │   ├── ChatHeader.vue        # 聊天头部
│   │   │   │   ├── ChatInput.vue         # 聊天输入
│   │   │   │   ├── ChatMessage.vue       # 单条消息
│   │   │   │   ├── ChatMessages.vue      # 消息列表
│   │   │   │   ├── ImageUploader.vue     # 图片上传
│   │   │   │   ├── Sidebar.vue           # 侧边栏
│   │   │   │   └── StepIndicator.vue     # 步骤指示器
│   │   │   ├── composables/ # 组合式函数
│   │   │   │   ├── useScroll.ts          # 滚动管理
│   │   │   │   └── useTheme.ts          # 主题管理
│   │   │   ├── router/   # 路由配置
│   │   │   ├── stores/   # Pinia 存储
│   │   │   │   └── chat.ts               # 聊天状态
│   │   │   ├── types/    # TypeScript 类型
│   │   │   ├── views/    # 页面视图
│   │   │   ├── App.vue   # 根组件
│   │   │   ├── main.ts   # 入口文件
│   │   │   └── style.css # 全局样式
│   │   └── vite.config.ts # Vite 配置
│   └── worker/           # Cloudflare Worker 后端
│       ├── src/
│       │   ├── core/     # 核心功能
│       │   ├── mcp/       # 模型调用协议
│       │   ├── skills/    # 技能模块
│       │   ├── types/     # 类型定义
│       │   ├── utils/     # 工具函数
│       │   └── index.ts  # Worker 入口
│       └── wrangler.toml # Worker 配置
├── .github/workflows/    # GitHub Actions 工作流
├── ERROR_LOG.md          # 错误记录文档
├── README.md             # 项目说明文档
├── package.json          # 根项目配置
└── pnpm-workspace.yaml   # pnpm 工作区配置
```

## 快速开始

### 前置条件

- Node.js 18.0 或更高版本
- pnpm 8.0 或更高版本
- Git 版本控制系统

### 安装依赖

```bash
# 安装所有项目依赖
pnpm install
```

### 启动开发服务器

```bash
# 启动前端开发服务器
pnpm --filter @ai-tool-chat/frontend dev

# 启动 Worker 开发服务器（可选）
pnpm --filter @ai-tool-chat/worker dev
```

前端应用将在 `http://localhost:5173/` 启动。

### 构建生产版本

```bash
# 构建前端应用
pnpm build

# 部署 Worker（可选）
pnpm deploy:worker
```

## 开发指南

### 代码规范

项目使用 ESLint 和 Prettier 确保代码质量和一致性：

```bash
# 运行代码检查
pnpm lint

# 自动格式化代码
pnpm format
```

### 提交规范

项目使用 Commitlint 确保提交信息符合规范：

```bash
# 提交信息格式：<type>(<scope>): <description>
# 示例：feat(frontend): 添加主题切换功能
```

### 组件开发

1. 在 `packages/frontend/src/components/` 目录下创建新组件
2. 使用 Vue 3 的 Composition API 和 TypeScript
3. 确保组件命名遵循 PascalCase 规范

### API 调用

所有 API 调用都封装在 `packages/frontend/src/api/` 目录下，主要通过 `ai.ts` 文件中的 `sendChatRequest` 函数进行。

## 部署指南

项目使用 GitHub Actions 自动部署：

1. **前端部署**：推送到 `main` 分支时，自动构建并部署到 Cloudflare Pages
2. **Worker 部署**：推送到 `main` 分支时，自动部署到 Cloudflare Workers

### 手动部署

#### 部署前端到 Cloudflare Pages

1. 登录 Cloudflare 控制台
2. 创建新的 Pages 项目
3. 连接 GitHub 仓库
4. 配置构建命令：`pnpm install && pnpm build`
5. 配置构建输出目录：`packages/frontend/dist`
6. 点击 "部署" 按钮

#### 部署 Worker 到 Cloudflare Workers

```bash
# 使用 Wrangler 部署
pnpm --filter @ai-tool-chat/worker deploy
```

## 环境变量

### 前端

前端应用需要配置以下环境变量（可选）：

- `VITE_API_URL`：API 服务器地址，默认为 Cloudflare Worker 地址

### Worker

Worker 需要配置以下环境变量：

- `OPENAI_API_KEY`：OpenAI API 密钥（可选）
- `ANTHROPIC_API_KEY`：Anthropic API 密钥（可选）
- `KIMI_API_KEY`：Kimi AI API 密钥（推荐）
- `ZHIPU_API_KEY`：智谱 AI API 密钥（可选）

### 模型配置

可以通过以下方式配置使用的 AI 模型：

1. **Kimi K2.5 配置**：

   ```bash
   ANTHROPIC_BASE_URL=https://api.moonshot.cn/anthropic
   ANTHROPIC_AUTH_TOKEN=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ANTHROPIC_DEFAULT_MODEL=kimi-k2-turbo-preview
   ```

2. **GLM 配置**：
   ```bash
   ANTHROPIC_BASE_URL=https://open.bigmodel.cn/api/anthropic
   ANTHROPIC_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ANTHROPIC_DEFAULT_MODEL=GLM-4.7
   ```

## 贡献指南

1. Fork 本仓库
2. 创建新分支：`git checkout -b feature/your-feature`
3. 提交更改：`git commit -m "feat: your feature description"`
4. 推送分支：`git push origin feature/your-feature`
5. 创建 Pull Request

## 许可证

MIT License

## 联系方式

如有问题或建议，欢迎通过以下方式联系：

- GitHub Issues：在本仓库创建 Issue
- Email：hu_liang2027@163.com

---

**感谢使用 AI Tool Chat Platform！** 🚀
