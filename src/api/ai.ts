// 定义聊天消息接口
// 表示聊天中的一条消息，包含角色（用户、助手或系统）和内容
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}
// 定义聊天选项接口
// 用于配置聊天请求的参数，如模型、温度等
export interface ChatOptions {
  model?: string
  temperature?: number
}

/**
 * 发送 SSE 聊天请求
 * @param messages 消息历史
 * @param onChunk 接收到流式数据块时的回调
 * @param onError 发生错误时的回调
 * @param onFinish 请求完成时的回调
 * @param signal AbortSignal 用于取消请求
 */
export async function sendChatRequest(
  messages: ChatMessage[],
  onChunk: (chunk: string) => void,
  onError: (error: Error) => void,
  onFinish: () => void,
  signal?: AbortSignal,
  options: ChatOptions = {}
) {
  try {
    // -------------------------------------------------------------------------
    // 配置区域
    // -------------------------------------------------------------------------
    
    // 1. 这里配置您的后端接口地址
    // [Cloudflare Workers] 替换为您的真实 Worker 地址
    // 建议绑定自定义域名（如 api.i-tool-chat.store）以解决国内移动网络访问问题
    const API_URL = 'https://api.i-tool-chat.store'
    
    // 2. 模拟数据开关逻辑
    // 如果没有后端，这里模拟一个流式响应用于演示。
    // [TODO] 如果您已准备好真实后端，请注释掉或删除下方的 if 块
    // if (API_URL.endsWith('/api/chat')) {
    //   await mockStreamResponse(messages, onChunk, signal)
    //   onFinish()
    //   return
    // }

    // -------------------------------------------------------------------------
    // 真实请求逻辑
    // -------------------------------------------------------------------------
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages,
        ...options
      }),
      signal,
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    if (!response.body) {
      throw new Error('Response body is null')
    }

    // 处理流式响应 (Server-Sent Events)
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = '' // 用于缓存未处理完的数据块

    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      
      // 解码并追加到缓冲区
      const chunk = decoder.decode(value, { stream: true })
      buffer += chunk
      
      // 按行处理缓冲区
      const lines = buffer.split('\n')
      // 保留最后一行（可能是不完整的），等待下一次拼接
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmedLine = line.trim()
        if (!trimmedLine || !trimmedLine.startsWith('data: ')) {
          continue // 忽略空行或非 data 开头的行
        }

        const data = trimmedLine.slice(6) // 去掉 'data: ' 前缀

        if (data === '[DONE]') {
          continue // 忽略结束标记
        }

        try {
          const json = JSON.parse(data)
          // 兼容 OpenAI/DeepSeek 格式
          const content = json.choices?.[0]?.delta?.content || ''
          if (content) {
            onChunk(content)
          }
        } catch (e) {
          console.error('Error parsing SSE data:', e)
        }
      }
    }

    onFinish()
  } catch (error: any) {
    if (error.name === 'AbortError') {
      console.log('Request aborted')
    } else {
      onError(error)
    }
  }
}

// -------------------------------------------------------------------------
// 模拟工具函数
// -------------------------------------------------------------------------

// 模拟流式响应，用于在没有后端时演示打字机效果
// async function mockStreamResponse(
//   messages: ChatMessage[],
//   onChunk: (chunk: string) => void,
//   signal?: AbortSignal
// ) {
//   if (messages.length === 0) return
//   const lastMsg = messages[messages.length - 1]?.content || ''
//   const responseText = `收到你的消息："${lastMsg}" 。\n\n这是一段模拟的流式回复。\n\nMarkdown 测试：\n- 第一点\n- 第二点\n\n\`\`\`javascript\nconsole.log('Hello World');\n\`\`\``
//   
//   const chunks = responseText.split('')
//   
//   for (const char of chunks) {
//     if (signal?.aborted) break
//     await new Promise(resolve => setTimeout(resolve, 30)) // 模拟网络延迟
//     onChunk(char)
//   }
// }
