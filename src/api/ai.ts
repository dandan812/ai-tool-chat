export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

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
    // 这里替换为你的实际 API 地址
    const API_URL = '/api/chat' 
    
    // 如果没有后端，这里模拟一个流式响应用于演示
    if (API_URL === '/api/chat') {
      await mockStreamResponse(messages, onChunk, signal)
      onFinish()
      return
    }

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

    const reader = response.body.getReader()
    const decoder = new TextDecoder()

    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      const chunk = decoder.decode(value, { stream: true })
      // 解析 SSE 格式 (这里假设后端返回的是简单的文本流或者标准的 SSE data: 格式)
      // 简单处理：直接返回文本
      onChunk(chunk)
      
      // 如果是标准 SSE (data: {...})，需要额外的解析逻辑
      // parseSSE(chunk, onChunk)
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

// 模拟流式响应
async function mockStreamResponse(
  messages: ChatMessage[],
  onChunk: (chunk: string) => void,
  signal?: AbortSignal
) {
  if (messages.length === 0) return
  const lastMsg = messages[messages.length - 1]?.content || ''
  const responseText = `收到你的消息："${lastMsg}"。\n\n这是一段模拟的流式回复。\n\nMarkdown 测试：\n- 第一点\n- 第二点\n\n\`\`\`javascript\nconsole.log('Hello World');\n\`\`\``
  
  const chunks = responseText.split('')
  
  for (const char of chunks) {
    if (signal?.aborted) break
    await new Promise(resolve => setTimeout(resolve, 30)) // 模拟打字机效果
    onChunk(char)
  }
}
