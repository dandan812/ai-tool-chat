# 排障手册

本文档不是历史报错堆栈，而是当前仓库的实际排障入口。  
建议先看 Worker 结构化日志里的这几个字段：

- `route`
- `requestType`
- `taskId`
- `fileId`
- `skill`
- `model`
- `durationMs`
- `errorCode`

## 1. 本地启动失败

### 现象

- 前端 `localhost:5173` 打不开
- Worker `127.0.0.1:8787` 无法启动
- `wrangler dev` 或 `pnpm dev` 直接退出

### 优先检查

1. 是否已安装依赖：
   ```bash
   pnpm install
   ```
2. 是否分别启动了前端和 Worker：
   ```bash
   pnpm --filter @ai-tool-chat/frontend dev
   pnpm --filter @ai-tool-chat/worker dev
   ```
3. Worker 本地环境变量是否存在：
   - `packages/worker/.dev.vars`
4. `wrangler.toml` 中的绑定是否和当前环境一致：
   - `CHUNK_STORAGE`
   - `UPLOADED_FILES`

### 常见原因

- `pnpm install` 后未重新启动终端
- `wrangler` 本地配置损坏
- `.dev.vars` 缺少模型 Key
- `wrangler.toml` 的 R2 / Durable Object 绑定名不匹配

---

## 2. 模型 Key 或额度问题

### 现象

- 健康检查显示某个模型供应商为 `false`
- 聊天返回 401 / 403 / 429
- 文件分析能进链路，但模型步骤失败

### 关键检查点

1. 访问本地或线上健康检查：
   - `/health`
2. 确认 `.dev.vars` 或线上环境里至少有一个可用模型 Key：
   - `GLM_API_KEY`
   - `QWEN_API_KEY`
   - `OPENAI_API_KEY`
3. 看日志中的：
   - `model`
   - `skill`
   - `errorCode`

### 典型情况

- `QWEN_API_KEY` 有 Key 但免费额度耗尽
- `DEFAULT_MODEL` 改成了 `glm-*`，但本地没有 `GLM_API_KEY`
- 线上健康检查正常，但请求实际路由到了没有额度的模型

### 建议做法

- 先用 `/health` 确认可用供应商
- 再用非流式请求确认 `task.metadata.model`
- 如果是额度问题，优先切到当前仍有额度的文本模型

---

## 3. 上传缺片、合并失败、断点续传异常

### 现象

- 首次查询 `/upload/status` 返回 `404`
- `upload/complete` 返回 400
- 提示：
  - `Incomplete upload`
  - `Missing chunks`
  - `未找到块 0`
  - `UPLOAD_MERGE_FAILED`

### 正常行为说明

- 首次上传某个 `fileId` 时，`GET /upload/status` 返回 `404` 是正常的
- 前端会把它视为“服务端还没有上传状态”，不是错误

### 当前实现边界

- Durable Object 只保存：
  - metadata
  - chunk 状态
  - 上传完成标记
- 文件正文写入 R2，不再写进 DO 单个大值

### 优先排查

1. 看日志中的：
   - `route=/upload/chunk`
   - `route=/upload/complete`
   - `fileId`
   - `errorCode`
2. 如果是小文件失败：
   - 清掉浏览器本地上传会话缓存
   - 重新选择同一个文件再试
3. 如果是大文件失败：
   - 确认是否已经切到 R2 正文存储版本
   - 确认不是旧部署版本

### 常见错误码

- `UPLOAD_CHUNK_INVALID_REQUEST`
- `UPLOAD_CHUNK_STORE_FAILED`
- `UPLOAD_MERGE_FAILED`
- `UPLOAD_STATUS_NOT_FOUND`
- `UPLOAD_STATUS_READ_FAILED`
- `UPLOADED_FILE_NOT_FOUND`
- `UPLOADED_FILE_READ_FAILED`

---

## 4. 文本文件检索优先回退与 Token 过高

### 现象

- 上传普通文本文件后分析很慢
- 日志显示 `selectedChunks=0`
- 前端提示“请缩小问题范围”
- 某些问题又会回退到全文摘要

### 当前策略

- 普通文本文件默认走“检索优先”
- 只有这些情况才回退到全文摘要：
  - 用户明确要求整份概览
  - 检索结果明显不足，且文件不算特别大
  - 小文件直接全文更便宜

### 需要看的日志字段

- `route=/chat`
- `requestType=file_analysis`
- `taskId`
- `skill=file-chat`
- `model`
- `errorCode=FILE_RETRIEVAL_SCOPE_LIMIT`

### 典型原因

- 用户问题过宽泛，没有显式关键词
- 文件内容本身结构很散，检索打分偏低
- 预算太紧，只能选很少片段

### 调优方向

- 问题更具体：章节、关键词、人物、时间点
- 适当调整：
  - `TEXT_RETRIEVAL_TOP_K`
  - `TEXT_RETRIEVAL_MAX_PROMPT_TOKENS`
  - `TEXT_RETRIEVAL_MIN_RELEVANCE`

---

## 5. Cloudflare 部署与绑定问题

### 现象

- 本地正常，线上异常
- Worker 部署成功，但上传或读取正文失败
- `wrangler deploy --dry-run` 能过，实际运行不正常

### 必查项

1. `wrangler.toml` 是否包含：
   - Durable Object：`CHUNK_STORAGE`
   - R2：`UPLOADED_FILES`
2. Cloudflare 后台是否真的创建了对应的 R2 bucket
3. 线上环境变量是否包含当前默认模型所需的 Key

### 推荐验证顺序

1. 本地：
   ```bash
   pnpm check
   ```
2. Worker 打包：
   ```bash
   pnpm --filter @ai-tool-chat/worker exec wrangler deploy --dry-run
   ```
3. 线上：
   - 访问 `/health`
   - 发一个最小文本请求
   - 再测文件上传

---

## 6. 快速定位顺序

当你只想快速判断问题在哪一层时，按这个顺序看：

1. `/health` 是否正常
2. Worker 日志里的 `route` 和 `requestType`
3. 是否有 `taskId` / `fileId`
4. `errorCode` 是哪一个
5. 当前 `model` / `skill` 是什么
6. 是本地问题、额度问题、还是部署绑定问题

---

## 7. 当前常用错误码速查

| 错误码 | 说明 |
| --- | --- |
| `CHAT_INVALID_JSON` | 聊天请求体不是合法 JSON |
| `CHAT_MESSAGES_REQUIRED` | 聊天请求缺少消息数组 |
| `UPLOAD_CHUNK_INVALID_REQUEST` | 上传分片缺少必要字段 |
| `UPLOAD_CHUNK_STORE_FAILED` | 分片写入 Durable Object 失败 |
| `UPLOAD_MERGE_FAILED` | 合并或写入 R2 失败 |
| `UPLOAD_STATUS_NOT_FOUND` | 首次查询或过期后找不到上传状态 |
| `UPLOAD_STATUS_READ_FAILED` | 读取上传状态失败 |
| `UPLOADED_FILE_NOT_FOUND` | 文件引用存在，但正文对象不存在 |
| `UPLOADED_FILE_READ_FAILED` | 从 R2 读取正文失败 |
| `FILE_RETRIEVAL_SCOPE_LIMIT` | 文件过大且检索不足，需要缩小问题范围 |

---

最后更新时间：2026-03-31
