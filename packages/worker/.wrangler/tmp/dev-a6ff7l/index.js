var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// .wrangler/tmp/bundle-9kgNdD/checked-fetch.js
var urls = /* @__PURE__ */ new Set();
function checkURL(request, init) {
  const url = request instanceof URL ? request : new URL(
    (typeof request === "string" ? new Request(request, init) : request).url
  );
  if (url.port && url.port !== "443" && url.protocol === "https:") {
    if (!urls.has(url.toString())) {
      urls.add(url.toString());
      console.warn(
        `WARNING: known issue with \`fetch()\` requests to custom HTTPS ports in published Workers:
 - ${url.toString()} - the custom port will be ignored when the Worker is published using the \`wrangler deploy\` command.
`
      );
    }
  }
}
__name(checkURL, "checkURL");
globalThis.fetch = new Proxy(globalThis.fetch, {
  apply(target, thisArg, argArray) {
    const [request, init] = argArray;
    checkURL(request, init);
    return Reflect.apply(target, thisArg, argArray);
  }
});

// src/skills/textSkill.ts
var textSkill = {
  name: "text-chat",
  type: "text",
  description: "\u57FA\u4E8E DeepSeek \u7684\u6587\u672C\u5BF9\u8BDD\u6280\u80FD",
  async *execute(input, context) {
    const { env, mcpClient } = context;
    const { messages, temperature = 0.7 } = input;
    const tools = mcpClient.listTools();
    const toolsDescription = tools.length > 0 ? `You can use tools by responding exactly with: <tool>${JSON.stringify(
      {
        tool: "tool_name",
        arguments: {}
      }
    )}</tool>
Available tools:
${tools.map((t) => `- ${t.name}: ${t.description}`).join("\n")}` : "";
    const finalMessages = toolsDescription ? [
      { role: "system", content: toolsDescription },
      ...messages
    ] : messages;
    let toolBuffer = "";
    try {
      const response = await fetch(
        "https://api.deepseek.com/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`
          },
          body: JSON.stringify({
            model: "deepseek-chat",
            messages: finalMessages,
            stream: true,
            temperature
          })
        }
      );
      if (!response.ok) {
        const error = await response.text();
        yield { type: "error", error: `DeepSeek API Error: ${error}` };
        return;
      }
      if (!response.body) {
        yield { type: "error", error: "Response body is null" };
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            const chunk = parseSSELine(line);
            if (chunk && chunk.type === "content" && chunk.content) {
              yield { type: "content", content: chunk.content };
              toolBuffer += chunk.content;
              while (true) {
                const start = toolBuffer.indexOf("<tool>");
                const end = toolBuffer.indexOf("</tool>");
                if (start !== -1 && end !== -1 && end > start) {
                  const inner = toolBuffer.slice(start + 6, end).trim();
                  toolBuffer = toolBuffer.slice(0, start) + toolBuffer.slice(end + 7);
                  let call = null;
                  try {
                    const obj = JSON.parse(inner);
                    call = {
                      id: `tool-${Date.now()}`,
                      name: obj.tool,
                      arguments: obj.arguments || {}
                    };
                  } catch {
                    call = null;
                  }
                  if (call) {
                    yield { type: "tool_call", toolCall: call };
                    const result = await mcpClient.callTool(
                      call.name,
                      call.arguments
                    );
                    yield { type: "tool_result", toolResult: result };
                    yield {
                      type: "content",
                      content: `
[Tool ${call.name} result]
${result.content?.slice(0, 1e3)}`
                    };
                  }
                } else {
                  break;
                }
              }
            }
          }
        }
        if (buffer.trim()) {
          const chunk = parseSSELine(buffer.trim());
          if (chunk && chunk.type === "content" && chunk.content) {
            yield { type: "content", content: chunk.content };
          }
        }
      } finally {
        reader.releaseLock();
      }
      yield { type: "complete" };
    } catch (error) {
      yield { type: "error", error: String(error) };
    }
  }
};
function parseSSELine(line) {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith("data: ")) {
    return null;
  }
  const data = trimmed.slice(6);
  if (data === "[DONE]") {
    return null;
  }
  try {
    const json = JSON.parse(data);
    const content = json.choices?.[0]?.delta?.content;
    if (content) {
      return { type: "content", content };
    }
  } catch {
  }
  return null;
}
__name(parseSSELine, "parseSSELine");

// src/skills/multimodalSkill.ts
var multimodalSkill = {
  name: "multimodal-chat",
  type: "multimodal",
  description: "\u57FA\u4E8E Qwen-VL \u7684\u56FE\u6587\u5BF9\u8BDD\u6280\u80FD",
  async *execute(input, context) {
    const { env, stepId } = context;
    const { messages, images = [], temperature = 0.7 } = input;
    if (!env.QWEN_API_KEY) {
      yield { type: "error", error: "QWEN_API_KEY not configured" };
      return;
    }
    try {
      const qwenMessages = buildQwenMessages(messages, images);
      const response = await fetch(
        "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.QWEN_API_KEY}`
          },
          body: JSON.stringify({
            model: "qwen-vl-plus",
            messages: qwenMessages,
            stream: true,
            temperature
          })
        }
      );
      if (!response.ok) {
        const error = await response.text();
        yield { type: "error", error: `Qwen API Error: ${error}` };
        return;
      }
      if (!response.body) {
        yield { type: "error", error: "Response body is null" };
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            const chunk = parseQwenSSELine(line);
            if (chunk) {
              yield chunk;
            }
          }
        }
        if (buffer.trim()) {
          const chunk = parseQwenSSELine(buffer.trim());
          if (chunk) {
            yield chunk;
          }
        }
      } finally {
        reader.releaseLock();
      }
      yield { type: "complete" };
    } catch (error) {
      yield { type: "error", error: String(error) };
    }
  }
};
function buildQwenMessages(messages, images) {
  return messages.map((msg) => {
    if (msg.role === "user" && images.length > 0) {
      const content = [];
      for (const img of images) {
        content.push({
          type: "image_url",
          image_url: {
            url: `data:${img.mimeType};base64,${img.base64}`
          }
        });
      }
      content.push({
        type: "text",
        text: msg.content || "\u8BF7\u63CF\u8FF0\u8FD9\u5F20\u56FE\u7247"
      });
      return {
        role: msg.role,
        content
      };
    }
    return {
      role: msg.role,
      content: msg.content
    };
  });
}
__name(buildQwenMessages, "buildQwenMessages");
function parseQwenSSELine(line) {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith("data: ")) {
    return null;
  }
  const data = trimmed.slice(6);
  if (data === "[DONE]") {
    return null;
  }
  try {
    const json = JSON.parse(data);
    const content = json.choices?.[0]?.delta?.content || json.choices?.[0]?.message?.content;
    if (content) {
      return { type: "content", content };
    }
  } catch {
  }
  return null;
}
__name(parseQwenSSELine, "parseQwenSSELine");

// src/skills/index.ts
var skillRegistry = /* @__PURE__ */ new Map();
function registerDefaultSkills() {
  registerSkill(textSkill);
  registerSkill(multimodalSkill);
}
__name(registerDefaultSkills, "registerDefaultSkills");
function registerSkill(skill) {
  skillRegistry.set(skill.name, skill);
  console.log(`[Skill] Registered: ${skill.name} (${skill.type})`);
}
__name(registerSkill, "registerSkill");
function selectSkill(input) {
  const { images = [], files = [] } = input;
  if (images.length > 0) {
    return multimodalSkill;
  }
  return textSkill;
}
__name(selectSkill, "selectSkill");
registerDefaultSkills();

// src/mcp/client.ts
var MCPClientImpl = class {
  static {
    __name(this, "MCPClientImpl");
  }
  tools = /* @__PURE__ */ new Map();
  resources = /* @__PURE__ */ new Map();
  env;
  constructor(env) {
    this.env = env;
    this.registerBuiltinTools();
  }
  /**
   * 注册内置工具
   */
  registerBuiltinTools() {
    this.registerTool({
      name: "execute_code",
      description: "\u6267\u884C JavaScript/TypeScript \u4EE3\u7801\u5E76\u8FD4\u56DE\u7ED3\u679C",
      parameters: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description: "\u8981\u6267\u884C\u7684\u4EE3\u7801"
          },
          language: {
            type: "string",
            enum: ["javascript", "typescript"],
            description: "\u4EE3\u7801\u8BED\u8A00"
          }
        },
        required: ["code"]
      }
    });
    this.registerTool({
      name: "web_search",
      description: "\u641C\u7D22\u7F51\u9875\u83B7\u53D6\u4FE1\u606F",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "\u641C\u7D22\u5173\u952E\u8BCD"
          },
          num_results: {
            type: "number",
            description: "\u8FD4\u56DE\u7ED3\u679C\u6570\u91CF",
            default: 5
          }
        },
        required: ["query"]
      }
    });
    this.registerTool({
      name: "file_operations",
      description: "\u8BFB\u53D6\u6216\u5199\u5165\u6587\u4EF6\u5185\u5BB9",
      parameters: {
        type: "object",
        properties: {
          operation: {
            type: "string",
            enum: ["read", "write"],
            description: "\u64CD\u4F5C\u7C7B\u578B"
          },
          path: {
            type: "string",
            description: "\u6587\u4EF6\u8DEF\u5F84"
          },
          content: {
            type: "string",
            description: "\u5199\u5165\u5185\u5BB9\uFF08\u4EC5 write \u64CD\u4F5C\u9700\u8981\uFF09"
          }
        },
        required: ["operation", "path"]
      }
    });
    this.registerTool({
      name: "calculate",
      description: "\u6267\u884C\u6570\u5B66\u8BA1\u7B97",
      parameters: {
        type: "object",
        properties: {
          expression: {
            type: "string",
            description: '\u6570\u5B66\u8868\u8FBE\u5F0F\uFF0C\u5982 "2 + 2" \u6216 "Math.sin(30)"'
          }
        },
        required: ["expression"]
      }
    });
    this.registerTool({
      name: "github_search_repositories",
      description: "\u641C\u7D22 GitHub \u4ED3\u5E93",
      parameters: {
        type: "object",
        properties: {
          q: { type: "string", description: "\u641C\u7D22\u5173\u952E\u8BCD" },
          page: { type: "number", description: "\u9875\u7801", default: 1 },
          per_page: { type: "number", description: "\u6BCF\u9875\u6570\u91CF", default: 10 }
        },
        required: ["q"]
      }
    });
    this.registerTool({
      name: "github_get_file_contents",
      description: "\u83B7\u53D6 GitHub \u4ED3\u5E93\u6587\u4EF6\u5185\u5BB9",
      parameters: {
        type: "object",
        properties: {
          owner: { type: "string", description: "\u4ED3\u5E93\u6240\u6709\u8005" },
          repo: { type: "string", description: "\u4ED3\u5E93\u540D" },
          path: { type: "string", description: "\u6587\u4EF6\u8DEF\u5F84" },
          branch: { type: "string", description: "\u5206\u652F\u540D\u79F0", default: "main" }
        },
        required: ["owner", "repo", "path"]
      }
    });
    this.registerTool({
      name: "github_create_issue",
      description: "\u5728 GitHub \u4ED3\u5E93\u521B\u5EFA Issue",
      parameters: {
        type: "object",
        properties: {
          owner: { type: "string", description: "\u4ED3\u5E93\u6240\u6709\u8005" },
          repo: { type: "string", description: "\u4ED3\u5E93\u540D" },
          title: { type: "string", description: "Issue \u6807\u9898" },
          body: { type: "string", description: "Issue \u5185\u5BB9" },
          assignees: {
            type: "array",
            description: "\u6307\u6D3E\u7528\u6237",
            items: { type: "string" }
          },
          labels: {
            type: "array",
            description: "\u6807\u7B7E",
            items: { type: "string" }
          }
        },
        required: ["owner", "repo", "title"]
      }
    });
    this.registerTool({
      name: "github_list_commits",
      description: "\u5217\u51FA\u4ED3\u5E93\u67D0\u5206\u652F\u7684\u63D0\u4EA4\u8BB0\u5F55",
      parameters: {
        type: "object",
        properties: {
          owner: { type: "string", description: "\u4ED3\u5E93\u6240\u6709\u8005" },
          repo: { type: "string", description: "\u4ED3\u5E93\u540D" },
          sha: {
            type: "string",
            description: "\u5206\u652F\u6216\u63D0\u4EA4 SHA",
            default: "main"
          },
          per_page: { type: "number", description: "\u6BCF\u9875\u6570\u91CF", default: 10 },
          page: { type: "number", description: "\u9875\u7801", default: 1 }
        },
        required: ["owner", "repo"]
      }
    });
  }
  /**
   * 注册工具
   */
  registerTool(tool) {
    this.tools.set(tool.name, tool);
    console.log(`[MCP] Tool registered: ${tool.name}`);
  }
  /**
   * 注册资源
   */
  registerResource(resource) {
    this.resources.set(resource.uri, resource);
    console.log(`[MCP] Resource registered: ${resource.uri}`);
  }
  /**
   * 列出所有工具
   */
  listTools() {
    return Array.from(this.tools.values());
  }
  /**
   * 调用工具
   */
  async callTool(name, args) {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        toolCallId: name,
        content: `Tool "${name}" not found`,
        isError: true
      };
    }
    try {
      const result = await this.executeTool(name, args);
      return {
        toolCallId: name,
        content: result,
        isError: false
      };
    } catch (error) {
      return {
        toolCallId: name,
        content: String(error),
        isError: true
      };
    }
  }
  /**
   * 执行具体工具逻辑
   */
  async executeTool(name, args) {
    switch (name) {
      case "execute_code": {
        const code = args.code;
        return `[Code execution simulated]
Code: ${code.slice(0, 100)}...`;
      }
      case "web_search": {
        const query = args.query;
        const numResults = args.num_results || 5;
        return `[Web search simulated]
Query: "${query}"
Found ${numResults} results`;
      }
      case "file_operations": {
        const operation = args.operation;
        const path = args.path;
        if (operation === "read") {
          return `[File read simulated]
Path: ${path}`;
        } else {
          const content = args.content;
          return `[File write simulated]
Path: ${path}
Content: ${content?.slice(0, 50)}...`;
        }
      }
      case "calculate": {
        const expression = args.expression;
        try {
          const result = Function(
            '"use strict"; return (' + expression + ")"
          )();
          return `Result: ${result}`;
        } catch {
          return `Error: Invalid expression "${expression}"`;
        }
      }
      // GitHub: 搜索仓库
      case "github_search_repositories": {
        const q = args.q;
        const per_page = args.per_page || 10;
        const page = args.page || 1;
        const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&per_page=${per_page}&page=${page}`;
        const headers = {
          Accept: "application/vnd.github+json"
        };
        if (this.env?.GITHUB_TOKEN) {
          headers["Authorization"] = `Bearer ${this.env.GITHUB_TOKEN}`;
        }
        const resp = await fetch(url, { headers });
        const json = await resp.json();
        return JSON.stringify(json);
      }
      // GitHub: 获取文件内容
      case "github_get_file_contents": {
        const owner = args.owner;
        const repo = args.repo;
        const path = args.path;
        const branch = args.branch || "main";
        const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch)}`;
        const headers = {
          Accept: "application/vnd.github+json"
        };
        if (this.env?.GITHUB_TOKEN) {
          headers["Authorization"] = `Bearer ${this.env.GITHUB_TOKEN}`;
        }
        const resp = await fetch(url, { headers });
        const json = await resp.json();
        if (json && json.content && json.encoding === "base64") {
          try {
            const decoded = atob(json.content.replace(/\n/g, ""));
            return JSON.stringify({
              name: json.name,
              path: json.path,
              content: decoded.slice(0, 5e3)
            });
          } catch {
            return JSON.stringify(json);
          }
        }
        return JSON.stringify(json);
      }
      // GitHub: 创建 Issue
      case "github_create_issue": {
        const owner = args.owner;
        const repo = args.repo;
        const title = args.title;
        const body = args.body || "";
        const assignees = args.assignees || [];
        const labels = args.labels || [];
        if (!this.env?.GITHUB_TOKEN) {
          return "Error: GITHUB_TOKEN not configured";
        }
        const url = `https://api.github.com/repos/${owner}/${repo}/issues`;
        const resp = await fetch(url, {
          method: "POST",
          headers: {
            Accept: "application/vnd.github+json",
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.env.GITHUB_TOKEN}`
          },
          body: JSON.stringify({ title, body, assignees, labels })
        });
        const json = await resp.json();
        return JSON.stringify(json);
      }
      // GitHub: 列出提交
      case "github_list_commits": {
        const owner = args.owner;
        const repo = args.repo;
        const sha = args.sha || "main";
        const per_page = args.per_page || 10;
        const page = args.page || 1;
        const url = `https://api.github.com/repos/${owner}/${repo}/commits?sha=${encodeURIComponent(sha)}&per_page=${per_page}&page=${page}`;
        const headers = {
          Accept: "application/vnd.github+json"
        };
        if (this.env?.GITHUB_TOKEN) {
          headers["Authorization"] = `Bearer ${this.env.GITHUB_TOKEN}`;
        }
        const resp = await fetch(url, { headers });
        const json = await resp.json();
        return JSON.stringify(json);
      }
      default:
        return `Tool "${name}" execution not implemented`;
    }
  }
  /**
   * 获取工具描述（用于 Prompt）
   */
  getToolsDescription() {
    const tools = this.listTools();
    if (tools.length === 0) return "";
    return `

You have access to the following tools:
${tools.map(
      (tool) => `- ${tool.name}: ${tool.description}
  Parameters: ${JSON.stringify(
        tool.parameters
      )}`
    ).join("\n")}

To use a tool, respond with: <tool>${JSON.stringify({
      tool: "tool_name",
      arguments: {}
    })}</tool>`;
  }
};
function createMCPClient(env) {
  return new MCPClientImpl(env);
}
__name(createMCPClient, "createMCPClient");

// src/utils/id.ts
function generateId() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 9);
  return `${timestamp}-${random}`;
}
__name(generateId, "generateId");

// src/core/taskManager.ts
var TaskManager = class {
  static {
    __name(this, "TaskManager");
  }
  tasks = /* @__PURE__ */ new Map();
  env;
  constructor(env) {
    this.env = env;
  }
  /**
   * 创建新 Task
   */
  createTask(request) {
    const taskId = generateId();
    const now = Date.now();
    const task = {
      id: taskId,
      type: this.determineTaskType(request),
      status: "pending",
      userMessage: request.messages[request.messages.length - 1]?.content || "",
      steps: [],
      createdAt: now,
      updatedAt: now
    };
    this.tasks.set(taskId, task);
    return task;
  }
  /**
   * 确定 Task 类型
   */
  determineTaskType(request) {
    if (request.images && request.images.length > 0) return "image";
    if (request.files && request.files.length > 0) return "file";
    if (request.enableTools) return "code";
    return "chat";
  }
  /**
   * 执行 Task
   */
  async *executeTask(taskId, request) {
    const task = this.tasks.get(taskId);
    if (!task) {
      yield { type: "error", data: { message: "Task not found" } };
      return;
    }
    task.status = "running";
    task.updatedAt = Date.now();
    yield { type: "task", data: { task, event: "started" } };
    try {
      const planStep = this.createStep(taskId, "plan", "\u5206\u6790\u9700\u6C42", "\u7406\u89E3\u7528\u6237\u610F\u56FE\u5E76\u89C4\u5212\u6267\u884C\u6B65\u9AA4");
      yield { type: "step", data: { step: planStep, event: "start" } };
      const needsMultimodal = !!(request.images && request.images.length > 0);
      const needsTools = !!request.enableTools;
      planStep.status = "completed";
      planStep.output = { needsMultimodal, needsTools };
      planStep.completedAt = Date.now();
      yield { type: "step", data: { step: planStep, event: "complete" } };
      const skillStep = this.createStep(
        taskId,
        "skill",
        needsMultimodal ? "\u591A\u6A21\u6001\u5904\u7406" : "\u6587\u672C\u5BF9\u8BDD",
        needsMultimodal ? "\u8C03\u7528 Qwen-VL \u5904\u7406\u56FE\u6587" : "\u8C03\u7528 DeepSeek \u751F\u6210\u56DE\u590D"
      );
      yield { type: "step", data: { step: skillStep, event: "start" } };
      const skill = selectSkill(request);
      const mcpClient = createMCPClient(this.env);
      let fullContent = "";
      for await (const chunk of skill.execute(
        {
          messages: request.messages,
          images: request.images,
          files: request.files,
          temperature: request.temperature
        },
        {
          taskId,
          stepId: skillStep.id,
          env: this.env,
          mcpClient
        }
      )) {
        if (chunk.type === "content") {
          fullContent += chunk.content;
          yield { type: "content", data: { content: chunk.content } };
        } else if (chunk.type === "error") {
          skillStep.status = "failed";
          skillStep.error = chunk.error;
          yield { type: "step", data: { step: skillStep, event: "error" } };
          throw new Error(chunk.error);
        }
      }
      skillStep.status = "completed";
      skillStep.output = { content: fullContent };
      skillStep.completedAt = Date.now();
      yield { type: "step", data: { step: skillStep, event: "complete" } };
      const respondStep = this.createStep(taskId, "respond", "\u751F\u6210\u54CD\u5E94", "\u6574\u7406\u5E76\u8FD4\u56DE\u6700\u7EC8\u7ED3\u679C");
      yield { type: "step", data: { step: respondStep, event: "start" } };
      task.result = fullContent;
      task.status = "completed";
      task.updatedAt = Date.now();
      respondStep.status = "completed";
      respondStep.output = { result: fullContent };
      respondStep.completedAt = Date.now();
      yield { type: "step", data: { step: respondStep, event: "complete" } };
      yield { type: "complete", data: { task } };
    } catch (error) {
      task.status = "failed";
      task.error = String(error);
      task.updatedAt = Date.now();
      yield { type: "error", data: { error: String(error), task } };
    }
  }
  /**
   * 创建 Step
   */
  createStep(taskId, type, name, description) {
    const step = {
      id: generateId(),
      taskId,
      type,
      status: "running",
      name,
      description,
      startedAt: Date.now()
    };
    const task = this.tasks.get(taskId);
    if (task) {
      task.steps.push(step);
    }
    return step;
  }
  /**
   * 获取 Task
   */
  getTask(taskId) {
    return this.tasks.get(taskId);
  }
  /**
   * 列出所有 Task
   */
  listTasks() {
    return Array.from(this.tasks.values());
  }
};

// src/index.ts
var src_default = {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type"
        }
      });
    }
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }
    try {
      const body = await request.json();
      const { messages = [], stream = true, images, files, enableTools } = body;
      if (!messages.length) {
        return new Response(
          JSON.stringify({ error: "Messages are required" }),
          {
            status: 400,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*"
            }
          }
        );
      }
      const taskManager = new TaskManager(env);
      const requestData = {
        messages,
        images,
        files,
        enableTools,
        temperature: body.temperature || 0.7,
        stream
      };
      const task = taskManager.createTask(requestData);
      if (!stream) {
        const chunks = [];
        for await (const chunk of taskManager.executeTask(
          task.id,
          requestData
        )) {
          chunks.push(chunk);
        }
        const finalTask = taskManager.getTask(task.id);
        return new Response(JSON.stringify({ task: finalTask, chunks }), {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
          }
        });
      }
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();
      const executeTask = /* @__PURE__ */ __name(async () => {
        try {
          for await (const event of taskManager.executeTask(
            task.id,
            requestData
          )) {
            const data = `data: ${JSON.stringify(event)}

`;
            await writer.write(encoder.encode(data));
          }
          await writer.write(encoder.encode("data: [DONE]\n\n"));
        } catch (error) {
          const errorEvent = {
            type: "error",
            data: { error: String(error) }
          };
          await writer.write(
            encoder.encode(`data: ${JSON.stringify(errorEvent)}

`)
          );
        } finally {
          await writer.close();
        }
      }, "executeTask");
      executeTask();
      return new Response(readable, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
          "Access-Control-Allow-Origin": "*"
        }
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: String(error) }), {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        }
      });
    }
  }
};

// ../../node_modules/.pnpm/wrangler@4.60.0/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../node_modules/.pnpm/wrangler@4.60.0/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-9kgNdD/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// ../../node_modules/.pnpm/wrangler@4.60.0/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-9kgNdD/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
