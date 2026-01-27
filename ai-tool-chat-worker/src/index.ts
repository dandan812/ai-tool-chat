export default {
  // Cloudflare Worker 的入口函数
  // req: 前端发来的请求对象，包含 URL、Method、Body 等信息
  // env: 环境变量对象，我们在 Cloudflare 后台配置的 API Key 就在这里面
  async fetch(req: Request, env: any) {
    // === 1. 处理 CORS 预检请求 (OPTIONS) ===
    // 浏览器在跨域发送 POST 请求前，会先发一个 OPTIONS 请求询问“我能不能连你？”
    // 这里我们直接返回“允许”，解决跨域问题
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*', // 允许任何域名访问（生产环境建议换成你自己的域名）
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        },
      })
    }

    // === 2. 限制请求方法 ===
    // 我们的接口只接受 POST 请求，其他的（如 GET）一律拒绝
    if (req.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 })
    }

    try {
      // 解析前端传来的 JSON 数据，提取聊天记录 messages
      const { messages } = await req.json() as any

      // === 3. 核心：代理转发给 DeepSeek ===
      // 这一步是在 Worker 服务器上发起的，所以前端用户看不到我们的 API Key
      const aiRes = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          // 从 env 对象中安全地读取 API Key
          'Authorization': `Bearer ${env.DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'deepseek-chat', // 指定使用 DeepSeek 模型
          stream: true, // 【关键】开启流式模式，让 AI 一个字一个字地吐
          messages,
        }),
      })

      // 检查上游（DeepSeek）是否正常返回了数据流
      if (!aiRes.body) {
        return new Response('No AI response body', { status: 500 })
      }

      // === 4. 构建流式管道 (Pipe) ===
      // TransformStream 就像一根水管：
      // - writable (入口): 我们把从 DeepSeek 读到的数据倒进去
      // - readable (出口): 我们把这个出口交给前端，前端就能接水了
      const { readable, writable } = new TransformStream()
      const writer = writable.getWriter()
      const reader = aiRes.body.getReader() // 获取 DeepSeek 的读取器
      const decoder = new TextDecoder()
      const encoder = new TextEncoder()

      // === 5. 启动搬运工 (异步任务) ===
      // 这是一个“一边读，一边写”的循环，不会阻塞主线程
      ;(async () => {
        try {
          while (true) {
            // 从 DeepSeek 读取一小块数据 (chunk)
            const { value, done } = await reader.read()
            if (done) break // 读完了，下班

            const chunk = decoder.decode(value)
            // 这里可以对 chunk 做处理（比如过滤敏感词），然后写入管道发给前端
            writer.write(encoder.encode(chunk))
          }
        } catch (e) {
          console.error('Stream error:', e)
        } finally {
          // 无论成功失败，最后都要把水管关掉，告诉前端“传输结束”
          writer.close()
        }
      })()

      // === 6. 返回响应给前端 ===
      // 把管道的出口 (readable) 给前端，并告诉浏览器这是“事件流”
      return new Response(readable, {
        headers: {
          'Content-Type': 'text/event-stream', // 核心 Header：告诉浏览器这是流
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*', // 允许跨域接收
        },
      })
    } catch (err) {
      // 如果中间出了任何错，返回 500 错误给前端
      return new Response(JSON.stringify({ error: String(err) }), { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      })
    }
  },
}
