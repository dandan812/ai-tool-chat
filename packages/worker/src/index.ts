export interface Env {
  DEEPSEEK_API_KEY: string;
}

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
      const body = await request.json() as any;
      const messages = body.messages || [];

      // 调用 DeepSeek API
      const response = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${env.DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages: messages,
          stream: true,
          temperature: body.temperature || 0.7,
        }),
      });

      // 创建流式响应
      const { readable, writable } = new TransformStream();
      response.body?.pipeTo(writable);

      return new Response(readable, {
        headers: {
          "Content-Type": "text/event-stream",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
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
