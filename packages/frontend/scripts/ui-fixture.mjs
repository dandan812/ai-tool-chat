// Local UI acceptance fixture. No production services or model calls are used.
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'

const port = Number(process.env.UI_FIXTURE_PORT || 8788)
const tasks = new Map()
const uploads = new Map()
let mode = 'normal'
const source = {
  sourceId: 'review-note',
  fileId: 'review-file',
  fileHash: 'fixture-hash',
  fileName: '需求评审纪要.md',
  excerpt:
    '本轮交付包含会话管理、文件分析与任务追踪。\n文件删除需二次确认，流式回答应支持取消。\n上线前检查手机上的遮挡与滚动。',
  startLine: 12,
  endLine: 14,
  startOffset: 80,
  endOffset: 160
}
const answer = [
  '已整理需求评审纪要。当前交付范围包含会话管理、文件分析和任务追踪，文件删除需要二次确认。[S:review-note]\n\n',
  '### 交付检查\n\n| 环节 | 验收项 | 状态 |\n| --- | --- | --- |\n| 对话 | 流式输出与取消 | 待验证 |\n| 文件 | 上传、引用与删除确认 | 待验证 |\n| 适配 | 手机滚动与弹窗 | 待验证 |\n\n',
  '### 风险与下一步\n\n1. 对上传中和过期文件保留明确状态。\n2. 取消任务后保留已生成内容与任务记录。\n3. 重要结论需对照原文复核。\n\n',
  '```typescript\nconst stages = ["对话", "文件", "任务"];\nconsole.log(stages.join(" / "));\n```\n'
]
let files = [
  { fileId: 'review-file', fileName: source.fileName, bytes: 12480, status: 'complete' },
  { fileId: 'api-file', fileName: '接口联调记录.txt', bytes: 28352, status: 'complete' },
  { fileId: 'log-file', fileName: '客户端错误日志-2026-10.txt', bytes: 168320, status: 'complete' },
  {
    fileId: 'long-file',
    fileName: '跨团队文件分析工作台验收记录与异常排查长文件名称.md',
    bytes: 8076,
    status: 'expired'
  },
  { fileId: 'pending-file', fileName: '批量导入记录.csv', bytes: 45320, status: 'uploading' }
]
function makeTask(id, userMessage, status = 'completed') {
  const createdAt = Date.now() - 1000 * 60 * (tasks.size + 1)
  const steps = ['route', 'skill'].map((type, index) => ({
    id: `${id}-${type}`,
    taskId: id,
    type,
    status: status === 'completed' || !index ? 'completed' : 'running',
    name: index ? '文件分析' : '选择处理能力',
    startedAt: createdAt,
    completedAt: status === 'completed' ? createdAt + 2000 : undefined
  }))
  const task = {
    id,
    type: 'file',
    status,
    userMessage,
    steps,
    createdAt,
    updatedAt: createdAt + 2000,
    result: status === 'completed' ? answer.join('') : '',
    error: status === 'failed' ? '测试环境中的模拟连接失败。' : undefined,
    metadata: { model: '本地验收模型', sources: [source] }
  }
  const events =
    status === 'completed'
      ? [
          { id: 1, type: 'content', data: { content: task.result } },
          { id: 2, type: 'sources', data: { sources: [source] } }
        ]
      : []
  tasks.set(id, { task, events, timers: [] })
  return tasks.get(id)
}
makeTask('review-task', '梳理需求评审纪要的交付范围与风险')
makeTask('api-task', '汇总接口联调记录中的待处理问题')
makeTask('code-task', '检查代码边界条件与错误处理')
makeTask('active-task', '分析批量导入任务', 'running')
makeTask('failed-task', '定位客户端连接异常', 'failed')

function append(entry, type, data) {
  entry.events.push({ id: entry.events.length + 1, type, data })
}
function send(response, data, status = 200) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(data))
}
async function readBody(request) {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  return Buffer.concat(chunks)
}
const server = createServer(async (request, response) => {
  const origin = request.headers.origin
  if (origin && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin)
    response.setHeader('Access-Control-Allow-Credentials', 'true')
    response.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, X-Account-ID, Idempotency-Key'
    )
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  }
  if (request.method === 'OPTIONS') {
    response.writeHead(204)
    response.end()
    return
  }
  const url = new URL(request.url, `http://127.0.0.1:${port}`)
  const path = url.pathname
  try {
    if (path === '/__qa/mode') {
      mode = url.searchParams.get('value') || 'normal'
      return send(response, { mode })
    }
    if (mode === 'error' && ['/tasks', '/auth/files', '/auth/usage'].includes(path)) {
      return send(response, { error: '本地验收：资源服务暂时不可用' }, 503)
    }
    if (mode === 'loading' && path === '/auth/files') {
      await new Promise((resolve) => setTimeout(resolve, 4000))
    }
    if (path === '/auth/me')
      return send(response, {
        user: { id: 'ui-fixture', username: '本地验收', guest: true },
        guestEnabled: true
      })
    if (path === '/auth/usage')
      return send(response, {
        chargedTokens: 8420,
        dailyTokenBudget: 100000,
        activeTasks: [...tasks.values()].filter(({ task }) => task.status === 'running').length
      })
    if (path === '/auth/files') return send(response, { files: mode === 'empty' ? [] : files })
    if (path === '/tasks' && request.method === 'GET') {
      return send(response, {
        tasks: mode === 'empty' ? [] : [...tasks.values()].map(({ task }) => task)
      })
    }
    if (path === '/tasks' && request.method === 'POST') {
      const body = JSON.parse((await readBody(request)).toString('utf8'))
      const question = body.messages.at(-1)?.content || '分析上传的文件'
      const entry = makeTask(randomUUID(), question, 'running')
      entry.task.createdAt = Date.now()
      entry.task.updatedAt = entry.task.createdAt
      entry.task.steps.forEach((step, index) => {
        step.startedAt = entry.task.createdAt
        step.completedAt = index ? undefined : entry.task.createdAt
      })
      for (const [index, content] of answer.entries()) {
        entry.timers.push(
          setTimeout(
            () => {
              if (entry.task.status !== 'running') return
              append(entry, 'content', { content })
              entry.task.result += content
              if (index === answer.length - 1) {
                entry.task.status = 'completed'
                entry.task.steps.forEach((step) => {
                  step.status = 'completed'
                  step.completedAt = Date.now()
                })
                append(entry, 'sources', { sources: [source] })
                append(entry, 'complete', { task: entry.task })
              }
            },
            question.includes('取消') ? 1500 + index * 30000 : (index + 1) * 1500
          )
        )
      }
      return send(response, { task: entry.task })
    }
    const taskMatch = path.match(/^\/tasks\/([^/]+)(?:\/(events|cancel))?$/)
    if (taskMatch) {
      const entry = tasks.get(taskMatch[1])
      if (!entry) return send(response, { error: '任务不存在' }, 404)
      if (taskMatch[2] === 'cancel') {
        entry.timers.forEach(clearTimeout)
        entry.task.status = 'cancelled'
        entry.task.updatedAt = Date.now()
        entry.task.error = '本地验收任务已取消。'
        entry.task.steps.forEach((step) => {
          if (step.status === 'running') {
            step.status = 'failed'
            step.error = entry.task.error
            step.completedAt = entry.task.updatedAt
          }
        })
        return send(response, { task: entry.task })
      }
      if (taskMatch[2] === 'events') {
        const after = Number(url.searchParams.get('after') || 0)
        const events = entry.events.filter((event) => event.id > after)
        return send(response, {
          events,
          lastEventId: events.at(-1)?.id || after,
          terminal: !['running', 'pending'].includes(entry.task.status)
        })
      }
      return send(response, { task: entry.task })
    }
    if (path === '/upload/status') {
      const upload = uploads.get(url.searchParams.get('fileId'))
      return upload ? send(response, upload) : send(response, { error: '尚未上传' }, 404)
    }
    if (path === '/upload/chunk') {
      const body = await readBody(request)
      const form = await new Response(body, {
        headers: { 'Content-Type': request.headers['content-type'] }
      }).formData()
      const fileId = form.get('fileId')
      const chunkIndex = Number(form.get('chunkIndex'))
      const previous = uploads.get(fileId)
      const indices = [...new Set([...(previous?.receivedIndices || []), chunkIndex])]
      const upload = {
        fileId,
        fileHash: form.get('fileHash'),
        fileName: form.get('fileName'),
        totalSize: Number(form.get('fileSize')),
        totalChunks: Number(form.get('totalChunks')),
        chunkSize: Number(form.get('chunkSize')),
        receivedIndices: indices,
        receivedChunks: indices.length
      }
      uploads.set(fileId, upload)
      return send(response, { ...upload, success: true, chunkIndex })
    }
    if (path === '/upload/complete') {
      const body = JSON.parse((await readBody(request)).toString('utf8'))
      const upload = uploads.get(body.fileId)
      if (!upload) return send(response, { error: '上传记录不存在' }, 404)
      const file = { ...body, size: upload.totalSize, source: 'uploaded' }
      files.push({
        fileId: body.fileId,
        fileName: body.fileName,
        bytes: upload.totalSize,
        status: 'complete'
      })
      return send(response, { success: true, file })
    }
    if (path === '/upload/delete') {
      files = files.filter((file) => file.fileId !== url.searchParams.get('fileId'))
      return send(response, { success: true })
    }
    return send(response, { error: '未配置的验收端点' }, 404)
  } catch (error) {
    send(response, { error: error.message }, 500)
  }
})
server.listen(port, '127.0.0.1', () => {
  console.log(`UI fixture: http://127.0.0.1:${port} (local test data only)`)
})
