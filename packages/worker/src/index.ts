/**
 * Worker Entry Point
 * Task → Step → Skill + MCP Client 架构
 * SSE 流式返回
 */
import type { Env, ChatRequest } from "./types";
import { TaskManager } from "./core/taskManager";

export { Env } from "./types";

export default {
  async fetch(request: Request, env: Env, ctx?: any): Promise<Response> {
    // 处理 CORS
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    try {
      // 解析请求
      const body = (await request.json()) as ChatRequest;
      const { messages = [], stream = true, images, files, enableTools } = body;

      if (!messages.length) {
        return new Response(
          JSON.stringify({ error: "Messages are required" }),
          {
            status: 400,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*",
            },
          },
        );
      }

      // 创建 TaskManager
      const taskManager = new TaskManager(env);

      // 创建 Task
      const requestData: ChatRequest = {
        messages,
        images,
        files,
        enableTools,
        temperature: body.temperature || 0.7,
        stream,
      };

      const task = taskManager.createTask(requestData);

      // 如果不使用流式响应，直接返回完整结果
      if (!stream) {
        const chunks: unknown[] = [];
        for await (const chunk of taskManager.executeTask(
          task.id,
          requestData,
        )) {
          chunks.push(chunk);
        }

        const finalTask = taskManager.getTask(task.id);
        return new Response(JSON.stringify({ task: finalTask, chunks }), {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }

      // 流式响应
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();

      // 异步执行 Task 并写入流
      const executeTask = async () => {
        try {
          for await (const event of taskManager.executeTask(
            task.id,
            requestData,
          )) {
            const data = `data: ${JSON.stringify(event)}\n\n`;
            await writer.write(encoder.encode(data));
          }

          // 发送完成标记
          await writer.write(encoder.encode("data: [DONE]\n\n"));
        } catch (error) {
          const errorEvent = {
            type: "error",
            data: { error: String(error) },
          };
          await writer.write(
            encoder.encode(`data: ${JSON.stringify(errorEvent)}\n\n`),
          );
        } finally {
          await writer.close();
        }
      };

      // 启动异步执行
      executeTask();

      // 返回 SSE 响应
      return new Response(readable, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "Access-Control-Allow-Origin": "*",
        },
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: String(error) }), {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }
  },
};
