/**
 * GLM Skill - 基于智谱 AI GLM API
 *
 * 作用：处理纯文本对话，调用 GLM 的聊天接口
 * 特点：支持流式响应（SSE），逐字返回给前端
 * 支持模型：glm-5、glm-4-flash 等 GLM 系列模型
 */
import type {
  Skill,
  SkillInput,
  SkillContext,
  SkillStreamChunk,
  Message,
} from "../types";
import { logger } from "../utils/logger";
import { parseChatCompletionSSELine } from "../utils/sse";

/**
 * GLM 技能定义
 * 符合 Skill 接口规范，可以被 Skill 注册中心调用
 */
export const glmSkill: Skill = {
  name: "glm-chat", // 技能唯一标识名
  type: "text", // 技能类型：纯文本
  description: "基于智谱 AI GLM 的文本对话技能", // 技能描述

  /**
   * 执行技能的核心方法
   * @param input - 输入数据（用户消息、温度参数等）
   * @param context - 执行上下文（包含 env 环境变量等）
   * @returns AsyncIterable - 异步生成器，流式返回内容
   *
   * 使用 async* 语法支持 yield 流式输出
   */
  async *execute(
    input: SkillInput,
    context: SkillContext,
  ): AsyncIterable<SkillStreamChunk> {
    const { env } = context; // 从上下文获取环境变量
    const { messages, temperature = 0.7 } = input; // 获取消息列表和温度参数
    const requestedModel = typeof input.model === "string" ? input.model : "";
    const model = requestedModel.startsWith("glm")
      ? requestedModel
      : env.DEFAULT_MODEL?.startsWith("glm")
        ? env.DEFAULT_MODEL
        : "glm-5";

    try {
      logger.info("Calling GLM API", { messageCount: messages.length });

      // 检查 API Key
      const apiKey = env.GLM_API_KEY as string;
      if (!apiKey) {
        logger.error("GLM_API_KEY not configured");
        yield { type: "error", error: "GLM_API_KEY 环境变量未配置" };
        return;
      }
      logger.debug("GLM API Key configured", { hasKey: !!apiKey, keyLength: apiKey.length });

      /**
       * 调用 GLM API
       * 使用 fetch 发送 POST 请求到 GLM 的聊天接口
       */
      const requestBody = {
        model, // 优先使用请求指定模型，其次使用默认 GLM 模型
        messages: messages as Message[], // 消息历史
        stream: true, // 启用流式响应
        temperature: temperature ?? 1, // 默认温度 1.0
        top_p: 0.95, // 核采样参数
        do_sample: true, // 启用采样
      };
      logger.debug("GLM API request", { url: "https://open.bigmodel.cn/api/paas/v4/chat/completions", model: requestBody.model });

      // 使用 AbortController 添加超时控制（30秒超时）
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(
        "https://open.bigmodel.cn/api/paas/v4/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`, // 使用 API Key 认证
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        },
      );

      clearTimeout(timeoutId);

      logger.info("GLM API response status", { status: response.status, ok: response.ok });

      // 处理 HTTP 错误响应
      if (!response.ok) {
        const error = await response.text();
        logger.error("GLM API error", { status: response.status, error });
        yield { type: "error", error: `GLM API Error (Status ${response.status}): ${error}` };
        return;
      }

      logger.info("GLM API response received", { status: response.status });

      // 检查响应体是否存在
      if (!response.body) {
        yield { type: "error", error: "Response body is null" };
        return;
      }

      /**
       * 流式读取响应数据
       *
       * 原理：使用 ReadableStream 的 getReader() 逐块读取数据
       * 这样可以边接收边返回给前端，实现"打字机"效果
       */
      const reader = response.body.getReader(); // 获取流的读取器
      const decoder = new TextDecoder(); // 用于将二进制转为文本
      let buffer = ""; // 数据缓冲区，处理不完整行
      let chunkCount = 0; // 统计返回了多少个内容块
      let rawResponse = ""; // 记录原始响应用于调试

      try {
        // 无限循环读取流数据，直到 done = true
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            logger.info("GLM API stream completed", { totalChunks: chunkCount });
            break; // 流结束，退出循环
          }

          // 将二进制数据解码为文本，{ stream: true } 支持多字节字符
          const chunkStr = decoder.decode(value, { stream: true });
          buffer += chunkStr;
          rawResponse += chunkStr;

          // 按行分割，但保留最后一个不完整的行到缓冲区
          const lines = buffer.split("\n");
          buffer = lines.pop() || ""; // 最后一行可能不完整，放回 buffer

          // 逐行处理完整的数据
          for (const line of lines) {
            const chunk = parseChatCompletionSSELine(line); // 解析 SSE 数据行
            if (chunk && chunk.type === "content") {
              chunkCount++;
              logger.debug(
                `Yielding content chunk #${chunkCount}: "${chunk.content?.slice(0, 20)}..."`,
              );
              yield chunk; // 通过 yield 流式返回给上层
            } else if (chunk && chunk.type === "error") {
              yield chunk; // 返回错误
            }
          }
        }

        // 处理缓冲区中最后剩余的数据
        if (buffer.trim()) {
          const chunk = parseChatCompletionSSELine(buffer.trim());
          if (chunk) {
            logger.debug(
              `Yielding final chunk: "${chunk.content?.slice(0, 20)}..."`,
            );
            yield chunk;
          }
        }

        // 如果没有产生任何内容块，记录原始响应
        if (chunkCount === 0) {
          logger.error("GLM API returned no content", { rawResponse: rawResponse.slice(0, 500) });
        }
      } finally {
        reader.releaseLock(); // 释放读取器锁，避免内存泄漏
      }

      // 流式传输完成
      yield { type: "complete" };
      logger.info("GLM API streaming completed", { totalChunks: chunkCount });
    } catch (error) {
      // 捕获整个过程中的异常
      logger.error("GLM API request failed", error);

      // 处理超时错误
      if (error instanceof Error && error.name === 'AbortError') {
        yield { type: "error", error: "GLM API 请求超时（30秒），请稍后重试" };
      } else {
        yield { type: "error", error: String(error) };
      }
    }
  },
};
