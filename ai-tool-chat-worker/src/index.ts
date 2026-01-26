export default {
  async fetch(req: Request, env: any) {
    // 处理 CORS 预检请求 (OPTIONS)
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      })
    }

    // 1. 只允许 POST 请求
    if (req.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 })
    }

    try {
      const { messages } = await req.json() as any

      // 2. 转发请求给 DeepSeek
      const aiRes = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          stream: true, // 开启流式
          messages,
        }),
      })

      // 3. 检查 OpenAI 响应
      if (!aiRes.body) {
        return new Response('No AI response body', { status: 500 })
      }

      // 4. 创建流转换器，实现透传
      const { readable, writable } = new TransformStream()
      const writer = writable.getWriter()
      const reader = aiRes.body.getReader()
      const decoder = new TextDecoder()
      const encoder = new TextEncoder()

      // 5. 异步处理流数据
      ;(async () => {
        try {
          while (true) {
            const { value, done } = await reader.read()
            if (done) break

            const chunk = decoder.decode(value)
            // 直接透传 OpenAI 的 SSE 数据
            writer.write(encoder.encode(chunk))
          }
        } catch (e) {
          console.error(e)
        } finally {
          writer.close()
        }
      })()

      // 6. 返回流式响应给前端
      return new Response(readable, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*', // 允许跨域
        },
      })
    } catch (err) {
      return new Response(JSON.stringify({ error: String(err) }), { status: 500 })
    }
  },
}
