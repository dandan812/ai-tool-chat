# 仓库开发说明

## 项目与目录

pnpm monorepo：

- `packages/frontend`：Vue 3、TypeScript、Pinia；页面、会话持久化和任务观察。
- `packages/worker`：共享业务与 Cloudflare 入口；认证、任务、上传、检索和模型调用。
- `packages/server`：主站的 Node.js HTTP 服务；复用共享业务，以 SQLite 和私有文件适配存储。

先读 `docs/guides/platform-reading-guide.md`，运行与部署配置见 `packages/server/README.md`。
历史 ADR 和验收记录仅描述其日期对应的实现，不应覆盖当前代码。

## 开发命令

使用 Node.js 24.21.0 与 pnpm 9：

```powershell
pnpm install
pnpm format          # 全仓库源码、测试和配置格式化
pnpm format:check    # 只检查格式
pnpm lint            # 三个包的静态检查
$env:VITE_API_URL='/api' # 本地同源预览；线上 API 配置见 Node 服务指南
pnpm build:frontend
pnpm build:server
pnpm preview:server  # http://127.0.0.1:3201，临时数据和模拟模型
pnpm check           # 格式、静态检查、类型、构建、测试和 Worker dry-run
```

单包检查：`pnpm check:frontend`、`pnpm check:worker`、`pnpm check:server`。
Cloudflare 本地入口：`pnpm --filter @ai-tool-chat/worker dev`。
生产发布需要任务明确授权；`pnpm check` 不部署，不产生付费模型请求。

## 代码规范

- 根目录 `.editorconfig`、`.prettierrc.json` 是格式规则的唯一来源，`.gitattributes` 固定 Git 换行：
  UTF-8、LF、两空格、单引号、无分号、100 列。
- TypeScript 使用严格模式；Vue 组件使用 PascalCase；按现有功能领域组织文件。
- 先搜索调用方，复用已有实现。只保留实际使用的配置、导出和抽象。
- 注释解释非显然的业务约束、权限、并发和生命周期，不复述语法。
- 对变更运行相关检查；测试只随真实契约变化调整，不为删除有效保护而删测试。

## 业务契约

- 一次请求是 Task，顶层步骤是 `route → skill`；文件研究的工具步骤沿用 `mcp` 类型。
  仅暴露附件内的只读搜索/读取，没有外部 MCP、任意执行或联网搜索。
- 浏览器通过 SSE 按游标读取持久事件；JSON 事件页仍供旧客户端使用。
  创建重试使用同一幂等键。恢复查看不得重新发起模型调用。
- 保留账户隔离、认证代次、文件归属与版本校验、文件租约、额度和用量结算。
- 任务认领后中断应保存部分结果并明确失败，不自动重试可能收费的请求。
- 兼容既有任务步骤和存储格式；没有显式迁移目标时不修改存储结构。
- 不将密钥写入前端、源码或日志。真实模型验收与线上部署需按具体任务授权。

## Git 提交信息规则

- 默认使用中文，并保留 Conventional Commits 前缀：
  `feat`、`fix`、`refactor`、`docs`、`chore`、`test`、`build`、`ci`。
- 格式：`type: 中文描述`。默认只输出一行，不加额外解释。
- 只有用户明确要求英文提交信息时才用英文。
- 保留已有未提交改动，不擅自提交、推送或回退他人的修改。
