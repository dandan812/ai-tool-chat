# API 接口文档

> 基于当前仓库代码整理，面向前端联调、后端排障和项目学习。  
> 默认生产地址：`https://api.i-tool-chat.store`  
> 默认本地开发地址：`http://127.0.0.1:8787`

## 1. 概览

当前 Worker 对外暴露的接口主要分 3 类：

- 聊天主链路
  - `POST /`
  - `POST /chat`
- 分片上传链路
  - `POST /upload/chunk`
  - `POST /upload/complete`
  - `GET /upload/status`
  - `POST /upload/delete`
- 运维 / 排障链路
  - `GET /health`
  - `GET /stats`

其中：

- `/` 是 `/chat` 的别名，前端默认直接请求根路径
- `/chat` 默认返回 `text/event-stream`，通过 SSE 流式返回任务事件
- 文件上传采用“分片上传 + 合并确认 + 断点续传状态查询”的方式

## 2. 通用约定

### 2.1 请求方法

- 允许：`GET`、`POST`
- 其他方法会返回 `400` 级错误

### 2.2 Content-Type

- `POST /chat`、`POST /upload/complete` 使用 `application/json`
- `POST /upload/chunk` 使用 `multipart/form-data`
- `GET` 请求不要求 `Content-Type`

### 2.3 请求体大小限制

- 中间件统一限制请求体最大为 `10MB`

### 2.4 CORS

所有接口统一返回：

```http
Access-Control-Allow-Origin: *
```

预检请求支持：

```http
OPTIONS *
Access-Control-Allow-Methods: POST, GET, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization
```

### 2.5 统一错误格式

除流式聊天中的 SSE 错误事件外，普通 HTTP 错误统一返回：

```json
{
  "error": {
    "message": "错误信息",
    "code": "错误码",
    "details": {
      "key": "value"
    }
  }
}
```

示例：

```json
{
  "error": {
    "message": "Messages are required",
    "code": "VALIDATION_ERROR",
    "details": {
      "code": "CHAT_MESSAGES_REQUIRED"
    }
  }
}
```

常见状态码：

- `200`：成功
- `400`：参数错误、请求格式错误、业务校验失败
- `404`：资源不存在
- `500`：服务内部错误
- `504`：超时

## 3. 核心数据结构

这一节只保留对接最常用的结构。

### 3.1 ChatMessage

```json
{
  "role": "user",
  "content": "你好"
}
```

字段说明：

- `role`: `system | user | assistant`
- `content`: 消息文本

### 3.2 Task

```json
{
  "id": "task_xxx",
  "type": "chat",
  "status": "running",
  "userMessage": "帮我总结一下这张图",
  "steps": [],
  "createdAt": 1710000000000,
  "updatedAt": 1710000001000,
  "metadata": {
    "model": "qwen3.5-plus",
    "skill": "multimodal-chat"
  }
}
```

字段说明：

- `id`: 任务 ID
- `type`: `chat | code | image | file`
- `status`: `pending | running | completed | failed`
- `userMessage`: 当前任务对应的用户输入
- `steps`: 当前任务关联步骤列表
- `result`: 完成时的最终结果
- `error`: 失败时的错误信息
- `metadata`: 模型、技能、耗时等附加信息

### 3.3 Step

```json
{
  "id": "step_xxx",
  "taskId": "task_xxx",
  "type": "skill",
  "status": "running",
  "name": "多模态处理",
  "description": "调用 qwen-vl-plus 处理图文",
  "startedAt": 1710000002000
}
```

字段说明：

- `type`: `plan | skill | mcp | think | respond`
- `status`: `pending | running | completed | failed`
- `name`: 步骤名称
- `description`: 步骤说明
- `output`: 完成后的步骤输出
- `error`: 失败时的错误信息

### 3.4 UploadedFileRef

```json
{
  "fileId": "md5hash-12345",
  "fileName": "report.txt",
  "mimeType": "text/plain",
  "size": 102400,
  "fileHash": "md5hash",
  "source": "uploaded"
}
```

这是文件上传完成后，前端在聊天请求里回传的文件引用。

## 4. 聊天接口

## 4.1 `POST /`

## 4.2 `POST /chat`

这两个路径等价，当前前端默认请求 `/`。

### 用途

发起一次聊天任务，支持：

- 纯文本对话
- 图文对话
- 文件分析
- SSE 流式任务事件返回

### 请求头

```http
Content-Type: application/json
```

### 请求体

```json
{
  "messages": [
    {
      "role": "user",
      "content": "请总结这段内容"
    }
  ],
  "images": [
    {
      "id": "img_1",
      "base64": "xxxx",
      "mimeType": "image/png",
      "description": "截图"
    }
  ],
  "files": [
    {
      "fileId": "md5hash-12345",
      "fileName": "report.txt",
      "mimeType": "text/plain",
      "size": 102400,
      "fileHash": "md5hash",
      "source": "uploaded"
    }
  ],
  "temperature": 0.7,
  "maxTokens": 2048,
  "stream": true,
  "enableTools": false,
  "model": "qwen3.5-flash-2026-02-23"
}
```

字段说明：

- `messages`: 必填，消息历史
- `images`: 可选，图片数组；有值时会优先走多模态 Skill
- `files`: 可选，已上传文件引用；有值时会走文件分析 Skill
- `temperature`: 可选，采样温度
- `maxTokens`: 可选，最大输出 token 数
- `stream`: 可选，默认 `true`
- `enableTools`: 可选，当前为实验能力标记
- `model`: 可选，指定模型

### 成功响应

#### 4.2.1 流式模式：`stream=true`

响应头：

```http
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
Access-Control-Allow-Origin: *
```

返回格式为 SSE，每一条消息都长这样：

```text
data: {"type":"task","data":{...}}

data: {"type":"step","data":{...}}

data: {"type":"content","data":{...}}

data: [DONE]
```

### SSE 事件类型

#### `task`

任务生命周期事件。

示例：

```json
{
  "type": "task",
  "data": {
    "task": {
      "id": "task_xxx",
      "type": "chat",
      "status": "running",
      "userMessage": "你好",
      "steps": [],
      "createdAt": 1710000000000,
      "updatedAt": 1710000000000
    },
    "event": "started"
  }
}
```

当前前端主要使用：

- `started`

#### `step`

步骤生命周期事件。

示例：

```json
{
  "type": "step",
  "data": {
    "step": {
      "id": "step_xxx",
      "taskId": "task_xxx",
      "type": "plan",
      "status": "completed",
      "name": "分析需求",
      "description": "理解用户意图并规划执行步骤",
      "startedAt": 1710000000100,
      "completedAt": 1710000000200,
      "output": {
        "needsMultimodal": false,
        "needsTools": false,
        "selectedSkill": "text-chat",
        "model": "qwen3.5-flash-2026-02-23"
      }
    },
    "event": "complete"
  }
}
```

`event` 常见值：

- `start`
- `complete`
- `error`

#### `content`

模型流式内容片段。

示例：

```json
{
  "type": "content",
  "data": {
    "content": "你好，"
  }
}
```

前端收到后会持续追加到当前 assistant 消息。

#### `error`

任务执行错误。

示例：

```json
{
  "type": "error",
  "data": {
    "error": "模型调用失败"
  }
}
```

#### `complete`

任务完成事件。

示例：

```json
{
  "type": "complete",
  "data": {
    "task": {
      "id": "task_xxx",
      "type": "chat",
      "status": "completed",
      "userMessage": "你好",
      "steps": [],
      "result": "你好，有什么我可以帮你？",
      "createdAt": 1710000000000,
      "updatedAt": 1710000003000,
      "metadata": {
        "model": "qwen3.5-flash-2026-02-23",
        "skill": "text-chat",
        "processingTime": 3000
      }
    }
  }
}
```

#### `[DONE]`

流结束标记，不是 JSON。

```text
data: [DONE]
```

前端用于把“生成中”状态切成“已完成”。

#### 4.2.2 非流式模式：`stream=false`

返回普通 JSON：

```json
{
  "task": {
    "id": "task_xxx",
    "type": "chat",
    "status": "completed",
    "userMessage": "你好",
    "steps": [],
    "result": "你好，有什么我可以帮你？",
    "createdAt": 1710000000000,
    "updatedAt": 1710000003000
  },
  "chunks": [
    {
      "type": "task",
      "data": {}
    },
    {
      "type": "step",
      "data": {}
    }
  ]
}
```

说明：

- 当前产品主链路默认走流式
- 非流式模式更适合测试或调试

### cURL 示例

纯文本聊天：

```bash
curl -N https://api.i-tool-chat.store/chat \
  -H "Content-Type: application/json" \
  -d "{\"messages\":[{\"role\":\"user\",\"content\":\"你好\"}],\"stream\":true}"
```

文件分析聊天：

```bash
curl -N https://api.i-tool-chat.store/chat \
  -H "Content-Type: application/json" \
  -d "{\"messages\":[{\"role\":\"user\",\"content\":\"总结这个文件\"}],\"files\":[{\"fileId\":\"md5hash-12345\",\"fileName\":\"report.txt\",\"mimeType\":\"text/plain\",\"size\":102400,\"fileHash\":\"md5hash\",\"source\":\"uploaded\"}],\"stream\":true}"
```

## 5. 上传接口

上传链路设计为：

1. 前端切片并计算 `fileHash`
2. 先查 `/upload/status`
3. 只上传缺失分片到 `/upload/chunk`
4. 最后调用 `/upload/complete`
5. 成功后拿到 `UploadedFileRef`
6. 在后续 `/chat` 请求里把该引用传回去

当前前端默认分片大小：

- `100KB`

`fileId` 生成方式：

- `${fileHash}-${file.size}`

## 5.1 `POST /upload/chunk`

### 用途

上传单个文件分片，支持断点续传和重复分片去重。

### 请求头

浏览器会自动生成 `multipart/form-data; boundary=...`。

### 请求体

`multipart/form-data`

字段说明：

- `fileId`: 必填，稳定文件 ID
- `fileName`: 建议传，文件名
- `fileSize`: 建议传，文件总大小
- `chunkIndex`: 必填，当前分片索引，从 `0` 开始
- `totalChunks`: 必填，分片总数
- `fileHash`: 建议传，文件 MD5
- `chunk`: 必填，当前二进制分片
- `mimeType`: 可选，默认 `text/plain`

### 成功响应

首次上传成功：

```json
{
  "success": true,
  "chunkIndex": 0,
  "fileId": "md5hash-102400",
  "receivedChunks": 1,
  "receivedIndices": [0]
}
```

重复上传已存在分片时：

```json
{
  "success": true,
  "duplicate": true,
  "chunkIndex": 0,
  "fileId": "md5hash-102400",
  "receivedChunks": 3,
  "receivedIndices": [0, 1, 2]
}
```

### 失败响应

参数缺失示例：

```json
{
  "error": {
    "message": "Missing required fields: fileId, chunk, or chunkIndex",
    "code": "VALIDATION_ERROR"
  }
}
```

## 5.2 `POST /upload/complete`

### 用途

通知服务端执行分片合并，成功后返回可用于聊天请求的文件引用。

### 请求头

```http
Content-Type: application/json
```

### 请求体

```json
{
  "fileId": "md5hash-102400",
  "fileHash": "md5hash",
  "fileName": "report.txt",
  "mimeType": "text/plain"
}
```

### 成功响应

```json
{
  "success": true,
  "file": {
    "fileId": "md5hash-102400",
    "fileName": "report.txt",
    "mimeType": "text/plain",
    "size": 102400,
    "fileHash": "md5hash",
    "source": "uploaded"
  }
}
```

### 失败情况

如果分片不完整，HTTP 侧会返回错误响应，常见业务原因是：

- 分片还没传完
- 服务端发现 `receivedChunks` 和真实已存分片不一致

底层合并失败时的业务信息通常类似：

```json
{
  "success": false,
  "error": "Incomplete upload: 2/3 chunks received"
}
```

但经过 HTTP handler 转换后，前端实际拿到的是统一错误格式。

## 5.3 `GET /upload/status?fileId=...`

### 用途

查询当前文件上传状态，用于断点续传。

### 请求参数

- `fileId`: 必填

### 成功响应

```json
{
  "fileId": "md5hash-102400",
  "fileName": "report.txt",
  "fileHash": "md5hash",
  "totalChunks": 3,
  "receivedChunks": 2,
  "receivedIndices": [0, 1],
  "percentage": 67,
  "isComplete": false
}
```

字段说明：

- `receivedIndices`: 已上传成功的分片下标
- `percentage`: 服务端已计算好的百分比
- `isComplete`: 是否已全部接收

### 未找到

```json
{
  "error": "File md5hash-102400 not found",
  "code": "UPLOAD_STATUS_NOT_FOUND"
}
```

状态码：

- `404`

## 5.4 `POST /upload/delete?fileId=...`

### 用途

删除上传中的残留状态、分片对象和已合并文件。

### 请求参数

- `fileId`: 必填，放在 query string 中

### 成功响应

```json
{
  "success": true
}
```

### 说明

- 当前前端在某些异常重试场景会调用它
- 即使服务端没有对应数据，也会尽量清理并返回统一结果

## 6. 运维接口

## 6.1 `GET /health`

### 用途

健康检查和基础能力探针。

### 成功响应

```json
{
  "status": "ok",
  "timestamp": "2026-04-13T10:00:00.000Z",
  "version": "2.0.0",
  "features": {
    "bailianText": true,
    "bailianMultimodal": true
  }
}
```

字段说明：

- `features.bailianText`: 是否具备文本模型能力
- `features.bailianMultimodal`: 是否具备多模态能力

## 6.2 `GET /stats`

### 用途

查看当前 Worker 实例内的任务统计。

### 成功响应

```json
{
  "tasks": {
    "total": 0,
    "pending": 0,
    "running": 0,
    "completed": 0,
    "failed": 0
  },
  "timestamp": "2026-04-13T10:00:00.000Z"
}
```

### 注意

- 这是实例内统计，不是全局持久化监控
- 更适合本地开发和轻量排障

## 7. 前端调用对照

这一节帮助你从前端代码快速找到对应接口。

### 聊天请求

前端入口：

- [`packages/frontend/src/api/requestManager.ts`](../packages/frontend/src/api/requestManager.ts)

关键行为：

- 发送 `POST /`
- 强制带上 `stream: true`
- 读取 `response.body`
- 按行解析 SSE

### 文件上传

前端入口：

- [`packages/frontend/src/utils/chunk.ts`](../packages/frontend/src/utils/chunk.ts)

实际调用顺序：

1. `GET /upload/status?fileId=...`
2. `POST /upload/chunk`
3. `POST /upload/complete`
4. 异常重试时可能调用 `POST /upload/delete?fileId=...`

## 8. 建议的阅读顺序

如果你是为了看懂项目接口设计，建议按这个顺序读源码：

1. [`packages/worker/src/index.ts`](../packages/worker/src/index.ts)
2. [`packages/worker/src/handlers/chatHandlers.ts`](../packages/worker/src/handlers/chatHandlers.ts)
3. [`packages/worker/src/handlers/uploadHandlers.ts`](../packages/worker/src/handlers/uploadHandlers.ts)
4. [`packages/worker/src/types/index.ts`](../packages/worker/src/types/index.ts)
5. [`packages/frontend/src/api/requestManager.ts`](../packages/frontend/src/api/requestManager.ts)
6. [`packages/frontend/src/utils/chunk.ts`](../packages/frontend/src/utils/chunk.ts)

## 9. 补充说明

- 本文档基于当前仓库代码整理，不是独立 OpenAPI 生成产物
- 如果后续接口字段变更，应该同步更新本文档
- 当前没有鉴权头要求；如果未来接入鉴权，这份文档也需要补充认证章节
