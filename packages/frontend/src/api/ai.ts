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
 * 发送 SSE (Server-Sent Events) 聊天请求
 * 这是一个通用的流式请求函数，负责与后端建立长连接并接收实时数据
 * 
 * @param messages 消息历史数组
 * @param onChunk 接收到流式数据块时的回调（每收到一个字都会触发）
 * @param onError 发生错误时的回调
 * @param onFinish 请求完成时的回调（无论成功失败都会触发）
 * @param signal AbortSignal 用于取消请求（比如用户点击停止生成）
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
    
    // 1. 后端接口地址
    // 这里的地址对应我们在 Cloudflare Workers 上部署的服务
    // 它就像一个中转站，帮我们将请求转发给 DeepSeek
    const API_URL = 'https://api.i-tool-chat.store'
    
    // 2. 发起 POST 请求
    // 注意这里不是普通的 await fetch() 拿结果，而是为了建立一个流式连接
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages, // 将聊天记录发给后端
        ...options
      }),
      signal, // 传递中断信号
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    if (!response.body) {
      throw new Error('Response body is null')
    }

    // -------------------------------------------------------------------------
    // 流式处理核心逻辑 (SSE Parsing)
    // -------------------------------------------------------------------------
    
    // 1. 获取读取器 (Reader)
    // response.body 是一个 ReadableStream，通过 getReader() 我们可以手动控制读取过程
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = '' // 【关键】缓冲区：用于拼接被截断的 JSON 字符串

    while (true) {
      // 2. 读取数据流
      // await reader.read() 会暂停执行，直到网络传输过来新的数据包
      const { done, value } = await reader.read()
      
      // 如果读取完毕 (done 为 true)，则跳出循环
      if (done) {
        break
      }
      
      // 3. 解码数据
      // value 是 Uint8Array (二进制数据)，需要转成字符串
      const chunk = decoder.decode(value, { stream: true })
      buffer += chunk // 将新数据追加到缓冲区
      
      // 4. 按行拆分
      // SSE 协议规定每条消息以换行符分隔
      const lines = buffer.split('\n')
      
      // 【关键技巧】保留最后一行
      // split 出来的最后一行可能是不完整的（因为网络包可能在任意位置截断）
      // 所以我们把它放回 buffer，等待下一个数据包来拼接
      buffer = lines.pop() || ''

      // 5. 逐行处理完整的数据
      for (const line of lines) {
        const trimmedLine = line.trim()
        
        // 过滤无效行：SSE 数据必须以 'data: ' 开头
        if (!trimmedLine || !trimmedLine.startsWith('data: ')) {
          continue 
        }

        // 提取 JSON 字符串（去掉 'data: ' 前缀）
        const data = trimmedLine.slice(6) 

        // 处理结束标记（OpenAI/DeepSeek 标准）
        if (data === '[DONE]') {
          continue 
        }

        try {
          // 解析 JSON
          const json = JSON.parse(data)
          
          // 提取核心内容
          // 不同的 AI 厂商字段结构可能略有不同，但通常都在 choices[0].delta.content
          const content = json.choices?.[0]?.delta?.content || ''
          
          // 如果有内容，通过回调函数通知 UI 更新
          if (content) {
            onChunk(content)
          }
        } catch (e) {
          // 容错处理：如果某一行 JSON 格式不对，不要让整个程序崩溃，只是打印错误
          console.error('Error parsing SSE data:', e)
        }
      }
    }

    // 循环结束，表示整个响应接收完毕
    onFinish()
  } catch (error: any) {
    // 错误处理
    if (error.name === 'AbortError') {
      console.log('Request aborted') // 用户手动停止
    } else {
      onError(error) // 其他网络或解析错误
    }
  }
}
