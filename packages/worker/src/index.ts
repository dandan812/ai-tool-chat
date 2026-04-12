/**
 * Worker 入口只保留系统骨架：
 * 1. 接收请求
 * 2. 按路径分发到对应 handler
 * 3. 统一通过中间件补齐日志、校验和错误处理
 *
 * 这样初学者先看这一层，就能知道“请求从哪里进、会被送到哪里”，
 * 再按 handler -> TaskManager -> Skill 的顺序继续往下读。
 */
import type { Env } from './types';
import { NotFoundError } from './types';
import {
  compose,
  withCORS,
  withErrorHandler,
  withValidation,
  withLogging,
} from './infrastructure/middleware';
import { ChunkStorage } from './upload/chunkStorage';
import { handleChatRequest } from './handlers/chatHandlers';
import { handleUploadChunk, handleUploadComplete, handleUploadStatus, handleUploadDelete } from './handlers/uploadHandlers';
import { handleHealthCheck, handleStatsRequest } from './handlers/systemHandlers';

/**
 * Durable Object 类需要从 Worker 入口文件重新导出，
 * Cloudflare 才能在部署时识别并绑定 `ChunkStorage`。
 *
 * 可以把它理解成：
 * - `default.fetch` 负责处理普通 HTTP 请求
 * - `export { ChunkStorage }` 负责告诉 Cloudflare “这个 Worker 还带了一个 DO 类”
 */
export { ChunkStorage };

/**
 * 主处理函数只做“按路径分发”这一件事。
 *
 * 这里故意不混入参数解析、日志、错误处理等细节，
 * 是为了让入口文件保持非常薄：
 * - 看这个函数，就能知道系统对外暴露了哪些 API
 * - 点进对应 handler，再看每条链路的业务细节
 *
 * 当前暴露的路由大致分成三类：
 * 1. 聊天链路：`/chat`
 * 2. 上传链路：`/upload/*`
 * 3. 运维/排障链路：`/health`、`/stats`
 */
async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  switch (url.pathname) {
    // `/` 直接复用聊天入口，
    // 这样本地调试或简单联通测试时，不一定非要显式写 `/chat`。
    case '/':
    case '/chat':
      return handleChatRequest(request, env);

    // 上传分片：前端把大文件切成很多块后，逐块打到这里。
    case '/upload/chunk':
      return handleUploadChunk(request, env);

    // 上传完成：前端确认所有缺失分片都补齐后，请求服务端执行 merge。
    case '/upload/complete':
      return handleUploadComplete(request, env);

    // 查询断点续传状态：前端刷新页面后会先问服务端“这个 fileId 现在传到哪了”。
    case '/upload/status':
      return handleUploadStatus(request, env);

    // 删除上传状态：用于清理残留分片、失效会话或用户主动取消上传。
    case '/upload/delete':
      return handleUploadDelete(request, env);

    // 健康检查：给本地调试、监控探针或快速排障使用。
    case '/health':
      return handleHealthCheck(env);

    // 轻量统计：查看当前 Worker 实例里的任务统计，不是全局持久化监控。
    case '/stats':
      return handleStatsRequest(env);

    // 未命中任何路由时，统一抛 NotFoundError，
    // 让后面的错误处理中间件去生成一致格式的 404 响应。
    default:
      throw new NotFoundError(`Route ${url.pathname}`);
  }
}

/**
 * 中间件组合顺序就是请求穿过系统骨架的顺序。
 *
 * 读取方式可以理解成：
 * 1. 请求先进 `withCORS`
 * 2. 再进 `withErrorHandler`
 * 3. 再进 `withValidation`
 * 4. 再进 `withLogging`
 * 5. 最后才进入 `handleRequest`
 *
 * 这样做的好处是每个关注点都独立：
 * - CORS 只管跨域头
 * - ErrorHandler 只管兜底异常
 * - Validation 只管基础请求校验
 * - Logging 只管结构化日志
 *
 * 入口路由本身因此能保持非常干净。
 */
const app = compose(
  withCORS,
  withErrorHandler,
  withValidation,
  withLogging
)(handleRequest);

export default {
  /**
   * Cloudflare Worker 的标准入口就是 `fetch(request, env)`。
   *
   * 这里没有直接把 `handleRequest` 导出去，而是先交给 `app`，
   * 因为我们希望所有请求默认都经过统一的中间件链。
   */
  fetch: async (request: Request, env: Env, ctx?: any): Promise<Response> => {
    return app(request, env);
  },
};
