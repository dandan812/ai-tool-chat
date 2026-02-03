/**
 * 文本 Skill - 基于 DeepSeek API
 * 
 * 作用：处理纯文本对话，调用 DeepSeek 的聊天接口
 * 特点：支持流式响应（SSE），逐字返回给前端
 */
import type { Skill, SkillInput, SkillContext, SkillStreamChunk, Message } from '../types';
import { logger } from '../utils/logger';

/**
 * 文本技能定义
 * 符合 Skill 接口规范，可以被 Skill 注册中心调用
 */
export const textSkill: Skill = {
  name: 'text-chat',        // 技能唯一标识名
  type: 'text',             // 技能类型：纯文本
  description: '基于 DeepSeek 的文本对话技能',  // 技能描述

  /**
   * 执行技能的核心方法
   * @param input - 输入数据（用户消息、温度参数等）
   * @param context - 执行上下文（包含 env 环境变量等）
   * @returns AsyncIterable - 异步生成器，流式返回内容
   * 
   * 使用 async* 语法支持 yield 流式输出
   */
  async *execute(input: SkillInput, context: SkillContext): AsyncIterable<SkillStreamChunk> {
    const { env } = context;                    // 从上下文获取环境变量
    const { messages, temperature = 0.7} = input;  // 获取消息列表和温度参数

    try {
      logger.info('Calling DeepSeek API', { messageCount: messages.length });

      /**
       * 调用 DeepSeek API
       * 使用 fetch 发送 POST 请求到 DeepSeek 的聊天接口
       */
      const response = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.DEEPSEEK_API_KEY}`,  // 使用 API Key 认证
        },
        body: JSON.stringify({
          model: 'deepseek-chat',               // 使用的模型
          messages: messages as Message[],      // 消息历史
          stream: true,                         // 启用流式响应
          temperature,                          // 温度参数（控制创造性）
        }),
      });

      // 处理 HTTP 错误响应
      if (!response.ok) {
        const error = await response.text();
        logger.error('DeepSeek API error', { status: response.status, error });
        yield { type: 'error', error: `DeepSeek API Error: ${error}` };
        return;
      }

      // 检查响应体是否存在
      if (!response.body) {
        yield { type: 'error', error: 'Response body is null' };
        return;
      }

      /**
       * 流式读取响应数据
       * 
       * 原理：使用 ReadableStream 的 getReader() 逐块读取数据
       * 这样可以边接收边返回给前端，实现"打字机"效果
       */
      const reader = response.body.getReader();  // 获取流的读取器
      const decoder = new TextDecoder();         // 用于将二进制转为文本
      let buffer = '';                           // 数据缓冲区，处理不完整行
      let chunkCount = 0;                        // 统计返回了多少个内容块

      try {
        // 无限循环读取流数据，直到 done = true
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;  // 流结束，退出循环

          // 将二进制数据解码为文本，{ stream: true } 支持多字节字符
          buffer += decoder.decode(value, { stream: true });
          
          // 按行分割，但保留最后一个不完整的行到缓冲区
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';  // 最后一行可能不完整，放回 buffer

          // 逐行处理完整的数据
          for (const line of lines) {
            const chunk = parseSSELine(line);  // 解析 SSE 数据行
            if (chunk && chunk.type === 'content') {
              chunkCount++;
              logger.debug(`Yielding content chunk #${chunkCount}: "${chunk.content?.slice(0, 20)}..."`);
              yield chunk;  // 通过 yield 流式返回给上层
            } else if (chunk && chunk.type === 'error') {
              yield chunk;  // 返回错误
            }
          }
        }

        // 处理缓冲区中最后剩余的数据
        if (buffer.trim()) {
          const chunk = parseSSELine(buffer.trim());
          if (chunk) {
            logger.debug(`Yielding final chunk: "${chunk.content?.slice(0, 20)}..."`);
            yield chunk;
          }
        }
      } finally {
        reader.releaseLock();  // 释放读取器锁，避免内存泄漏
      }

      // 流式传输完成
      yield { type: 'complete' };
      logger.info('DeepSeek API streaming completed', { totalChunks: chunkCount });

    } catch (error) {
      // 捕获整个过程中的异常
      logger.error('DeepSeek API request failed', error);
      yield { type: 'error', error: String(error) };
    }
  },
};

/**
 * 解析 SSE（Server-Sent Events）数据行
 * 
 * SSE 格式示例：
 * data: {"choices":[{"delta":{"content":"你好"}}]}
 * 
 * @param line - 一行 SSE 数据
 * @returns SkillStreamChunk - 解析后的内容块，或 null 如果无效
 */
function parseSSELine(line: string): SkillStreamChunk | null {
  const trimmed = line.trim();
  
  // 只处理以 "data: " 开头的行
  if (!trimmed || !trimmed.startsWith('data: ')) {
    return null;
  }

  // 去掉 "data: " 前缀
  const data = trimmed.slice(6);
  
  // [DONE] 是流式传输结束标记
  if (data === '[DONE]') {
    return null;
  }

  try {
    // 解析 JSON 数据
    const json = JSON.parse(data);
    
    // 提取内容（OpenAI 兼容格式）
    const content = json.choices?.[0]?.delta?.content;
    
    // 如果内容存在，返回内容块
    if (content !== undefined && content !== null) {
      return { type: 'content', content: String(content) };
    }
  } catch {
    // JSON 解析失败，忽略这行数据
  }

  return null;
}
