# 后端阅读入口

这份文档的目标不是覆盖所有实现细节，而是帮助刚接手项目的人先建立一张稳定的阅读地图。

## 推荐阅读顺序

1. `packages/worker/src/index.ts`
2. `packages/worker/src/core/taskManager.ts`
3. `packages/worker/src/skills/index.ts`
4. 具体 Skill：
   - `packages/worker/src/skills/textSkill.ts`
   - `packages/worker/src/skills/multimodalSkill.ts`
   - `packages/worker/src/skills/fileSkill.ts`
5. 上传链路：
   - `packages/worker/src/chunkStorage.ts`
   - `packages/worker/src/chunkStorageService.ts`
6. 工具层：
   - `packages/worker/src/utils/ragRetriever.ts`
   - `packages/worker/src/utils/codeCompressor.ts`

## 先看什么

### 1. 先看入口层

`packages/worker/src/index.ts` 只负责三件事：

- 接收 HTTP 请求
- 按路径分发到不同 handler
- 通过中间件统一补日志、校验和错误处理

如果先把这一层看懂，你会知道：

- `/chat` 是怎么进入任务系统的
- `/upload/*` 为什么会走 Durable Object
- `/health` 和 `/stats` 为什么是单独的系统接口

### 2. 再看 TaskManager

`packages/worker/src/core/taskManager.ts` 是后端主链路的骨架。

它现在只保留：

- 创建任务
- 启动执行
- 查询任务
- 返回统计

真正的细节被拆到了：

- `packages/worker/src/core/taskStore.ts`
  - 任务生命周期、缓存和统计
- `packages/worker/src/core/taskStepRunner.ts`
  - `plan -> skill -> respond` 步骤编排
- `packages/worker/src/core/taskTimeout.ts`
  - 超时收尾

先看 TaskManager 的原因是：这层最能帮助新人建立 `Task -> Step -> Skill` 的心智模型。

## 再看什么

### 3. 看 Skill 选择层

`packages/worker/src/skills/index.ts` 决定：

- 有图片时走哪条链路
- 有文件时走哪条链路
- 默认文本模型如何进入 `textSkill`

读到这里时，不要先钻 provider 或工具层，先理解“请求会被送到哪个 Skill”。

### 4. 看上传链路

上传链路是这个项目里工程复杂度最高的一段，但现在已经分成两层：

- `packages/worker/src/chunkStorage.ts`
  - Durable Object 入口壳
- `packages/worker/src/chunkStorageService.ts`
  - metadata 修复、分片合并、R2 写入和清理

这样读的时候就不会在一个文件里同时面对“HTTP action、状态机、存储和错误恢复”。

## 最后再看工具层

### 5. `ragRetriever` 和 `codeCompressor`

这两个文件不是系统入口，而是策略工具层。

- `packages/worker/src/utils/ragRetriever.ts`
  - 对外入口
- 相关子模块负责：
  - 关键词提取
  - 代码片段解析
  - 相关性评分
  - 输出格式化

- `packages/worker/src/utils/codeCompressor.ts`
  - 对外入口
- 相关子模块负责：
  - 语言配置
  - 注释/空行清理
  - 结构提取
  - 压缩输出构造
  - 统计生成

建议把这层放到最后看，因为它们解释的是“如何优化上下文”，不是“请求如何跑完整条链路”。

## 初学者最容易卡住的点

### 1. 一上来先读工具层

如果先读 `ragRetriever` 或 `codeCompressor`，很容易误以为这两个文件是系统核心入口。实际上它们只是被 Skill 间接调用的策略工具。

### 2. 把 TaskManager 理解成业务实现

TaskManager 更像“编排骨架”，不是每个能力的具体实现。真正的回答生成仍然发生在 Skill 和 provider 里。

### 3. 把 Durable Object 当成普通工具类

`ChunkStorage` 不是普通帮助函数，而是上传状态持久化边界。它存在的原因，是为了支持断点续传和服务端合并，不是为了“让代码好看”。

## 最后一句建议

第一次读这个后端时，严格按下面顺序走：

`index.ts -> taskManager.ts -> skills/index.ts -> 具体 skill -> chunkStorage -> utils`

只要顺序对了，理解成本会比“随便点一个大文件开始看”低很多。
