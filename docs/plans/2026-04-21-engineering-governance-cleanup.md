# 工程治理收口优化 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 收口 monorepo 的包管理、仓库卫生、检查脚本职责和 Worker 校验链路，并保持前端运行时逻辑不变。

**Architecture:** 在根目录增加一个无副作用的仓库卫生检查脚本，统一由 `pnpm check` 驱动；前端只拆分 lint 检查与修复职责；Worker 采用包内最小 TS/ESLint 配置补齐 `lint` 与 `typecheck`。CI 继续复用根目录 `check`，Worker 部署链路在真正部署前先跑独立校验。

**Tech Stack:** pnpm workspace、Node.js 脚本、ESLint 9 Flat Config、TypeScript、Vitest、Wrangler、GitHub Actions

---

### Task 1: 收口根目录脚本与仓库卫生检查

**Files:**
- Create: `scripts/check-repo.mjs`
- Modify: `package.json`
- Modify: `.gitignore`

**Step 1: 写仓库卫生检查脚本**

实现两个强校验：
- 根目录只允许保留 `pnpm-lock.yaml`
- Git 索引中不允许出现任何 `.wrangler` 路径

**Step 2: 把 `check:repo` 接入根目录脚本**

Run: `pnpm run check:repo`
Expected: 在 lockfile 或 `.wrangler` 跟踪异常存在时失败

**Step 3: 调整根目录 `check` 串联顺序**

Run: `pnpm run check`
Expected: 先跑仓库卫生，再跑前端与 Worker 检查

### Task 2: 收口前端 lint 职责

**Files:**
- Modify: `packages/frontend/package.json`

**Step 1: 将前端 `lint` 改为纯检查**

保留现有 ESLint 配置，不让 `lint` 命令写回文件。

**Step 2: 新增 `lint:fix`**

Run: `pnpm --filter @ai-tool-chat/frontend lint`
Expected: 只返回检查结果，不修改工作区文件

### Task 3: 为 Worker 补齐本地 lint/typecheck 配置

**Files:**
- Create: `packages/worker/tsconfig.json`
- Create: `packages/worker/eslint.config.mjs`
- Modify: `packages/worker/package.json`

**Step 1: 添加 Worker 本地 TypeScript 配置**

Run: `pnpm --filter @ai-tool-chat/worker typecheck`
Expected: 仅检查 Worker 源码与测试配置，不产出构建文件

**Step 2: 添加 Worker 最小 ESLint 配置**

Run: `pnpm --filter @ai-tool-chat/worker lint`
Expected: 只检查 Worker 源码与配置，不触碰前端配置

**Step 3: 调整根目录 `check:worker`**

Run: `pnpm run check:worker`
Expected: 依次执行 `lint`、`typecheck`、`test`、`wrangler deploy --dry-run`

### Task 4: 更新 CI 并清理错误跟踪产物

**Files:**
- Modify: `.github/workflows/deploy-worker.yml`
- Delete: `packages/frontend/package-lock.json`
- Delete: `packages/frontend/pnpm-lock.yaml`
- Update Git index: `packages/worker/.wrangler/**`

**Step 1: 部署前改为执行新的 Worker 校验链路**

Run: `pnpm run check:worker`
Expected: 部署工作流与本地链路保持一致

**Step 2: 删除前端嵌套 lockfile 并移除 `.wrangler` 跟踪**

Run: `git ls-files packages/frontend/package-lock.json packages/frontend/pnpm-lock.yaml packages/worker/.wrangler`
Expected: 不返回任何结果

**Step 3: 做回归验证**

Run: `pnpm check`
Expected: 全量通过，且连续执行两次后 `git status` 不新增由检查命令产生的变更
