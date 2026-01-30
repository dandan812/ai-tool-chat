# AI Tool Chat Platform

AI 对话与工具平台，基于 Vue 3 构建的现代化前端应用。

## 功能特性


- 🤖 **AI 智能对话**：与 AI 助手进行实时对话，获取智能回答
- 💬 **对话历史管理**：查看、切换和删除对话历史
- 💾 **本地持久化**：对话数据存储在本地，确保数据安全
- 🌙 **主题切换**：支持浅色和深色主题，适应不同使用场景
- 📱 **响应式设计**：适配不同屏幕尺寸，在手机和电脑上都有良好表现
- ⚙️ **助手人设设置**：自定义 AI 助手的系统提示词，调整助手行为

## 技术栈

### 前端
- **框架**：Vue 3 + TypeScript
- **状态管理**：Pinia
- **路由**：Vue Router
- **构建工具**：Vite
- **代码规范**：ESLint + Prettier
- **样式**：原生 CSS + SASS

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
│   │   │   ├── composables/ # 组合式函数
│   │   │   ├── router/   # 路由配置
│   │   │   ├── stores/   # Pinia 存储
│   │   │   ├── views/    # 页面视图
│   │   │   ├── App.vue   # 根组件
│   │   │   └── main.ts   # 入口文件
│   │   └── vite.config.ts # Vite 配置
│   └── worker/           # Cloudflare Worker 后端
│       ├── src/
│       │   └── index.ts  # Worker 入口
│       └── wrangler.toml # Worker 配置
├── .github/workflows/    # GitHub Actions 工作流
├── package.json          # 根项目配置
└── pnpm-workspace.yaml   # pnpm 工作区配置
```

## 快速开始

### 前置条件

- Node.js 16.0 或更高版本
- pnpm 8.0 或更高版本

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

- `OPENAI_API_KEY`：OpenAI API 密钥
- `ANTHROPIC_API_KEY`：Anthropic API 密钥（可选）

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