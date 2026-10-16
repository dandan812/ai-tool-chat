# AI Tool Chat

Vue 3 多会话 AI 工作台，支持文本与图片对话、PDF / Word / Excel / 文本文件问答、
受限资料研究、分片上传、引用核对和生成结果恢复查看。

- 主站：[chat.i-tool-chat.store](https://chat.i-tool-chat.store/)
- [代码阅读指南](docs/guides/platform-reading-guide.md)：两条业务链路和对应文件。
- [Node 服务指南](packages/server/README.md)：配置、部署、运行边界和历史发布记录。
- [本轮精简记录](docs/reference/2026-10-16-code-cleanup.md)：删除依据、验证和源码恢复位置。

## 目录与职责

```text
packages/
  frontend/   Vue 3 + TypeScript + Pinia，页面、会话、上传和任务观察
  worker/     共享业务：认证、额度、任务、上传、检索和模型调用；保留 Worker 入口
  server/     Node HTTP 入口，SQLite、本地私有文件和文档解析适配
scripts/      仓库检查与本地验证
docs/
  guides/     当前代码阅读入口
  adr/        架构决策与历史取舍
  reference/  有日期的验收和发布记录
```

主站运行 Node 后端；`packages/worker` 的业务模块由 Node 服务复用。
Node 使用 SQLite 和私有文件，Worker 使用 Durable Objects 和 R2；
两种运行方式共用任务与上传协议，没有自动迁移彼此的数据。

## 本地运行

使用 Node.js 24.21.0 和 pnpm 9。在仓库根目录执行：

```powershell
pnpm install
$env:VITE_API_URL='/api'
pnpm build:frontend
pnpm build:server
pnpm preview:server
```

预览默认地址是 `http://127.0.0.1:3201`，使用独立临时数据和明确标记的模拟模型，
不调用付费模型。前后端同源，通过 `/api` 使用账户 cookie。
前端开发服务器及真实模型配置见 [Node 服务指南](packages/server/README.md)。

Cloudflare 本地开发与部署入口仍保留：

```powershell
pnpm --filter @ai-tool-chat/worker dev
pnpm deploy:worker
```

Worker 环境变量见 `packages/worker/.dev.vars.example`；
Node 环境变量见 `packages/server/.env.example`。密钥只放在受保护的服务端配置中。

## 两条业务链路

**对话与恢复：** 输入问题 → 创建持久任务 → 选择 Skill → 调用模型 →
保存输出事件 → 浏览器通过 SSE 按游标接收 → 终态快照同步。

创建请求的重试保留幂等键；刷新或重连读取同一任务，不重新发起模型调用。
已经认领的执行中断后保留部分结果并明确失败，不自动重试可能收费的请求。
停止查看和取消后台任务是两个操作。

**上传与问答：** 查询分片状态 → 补传缺片 → 合并与版本校验 →
按账户验证文件引用 → 解析或读取正文 → 选择原文片段 → 生成回答与引用。

普通文件问答最多一次生成调用；依据不足时不调用模型。
显式启用的资料研究使用本次附件内的只读搜索和读取工具，最多两轮工具决策加一次回答。
没有外部 MCP 服务、任意代码执行或联网搜索。
引用可核对不代表回答语义自动正确；扫描 PDF 仍需 OCR。

## 代码规范与验证

三个包共用根目录 `.editorconfig` 和 `.prettierrc.json`：
UTF-8、LF、两空格、单引号、无分号、100 列。
Vue 组件用 PascalCase，业务按功能目录组织；配置只保留实际使用的内容。
注释说明权限、并发、持久化和取舍，避免逐行复述代码。

```powershell
pnpm format          # 统一源码、配置和测试格式
pnpm format:check    # 只检查格式
pnpm lint            # 前端、共享业务和 Node 服务静态检查
pnpm check           # 仓库检查、格式、类型、构建、全部测试与 Worker dry-run
```

`pnpm check` 不部署，不使用真实模型。分包入口为
`pnpm check:frontend`、`pnpm check:worker`、`pnpm check:server`。
性能基准默认跳过，只在指定基准环境变量后单独运行。

## 部署与兼容边界

Node 生产发布使用 `pnpm package:server` 生成独立部署包。
部署说明和回退步骤以 [Node 服务指南](packages/server/README.md) 为准。
本轮源码整理不代表线上已更新。

保留现有 HTTP 路由、旧任务步骤类型、账户与文件归属校验、存储格式、
事件游标和用量结算。公开 API 见 [接口说明](docs/api-reference.md)
和 [OpenAPI](docs/openapi.yaml)。
历史 ADR 和测试数字只说明对应日期的实现与验证范围。

## License

MIT
