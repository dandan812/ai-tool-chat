# 一期资料分析工作台交付说明

## 范围

基于公开仓库基线 74a46ea 的独立本地开发副本实现。没有推送 main（仓库 main push 会触发自动部署），没有部署 Cloudflare 或修改线上数据。

已实现用户名账户与安全Cookie、账户隔离的文件及本地历史、任务与调用预算、持久任务和事件恢复、取消后台与停止查看、原文引用、使用量/估算成本记录，以及固定30题离线检索评测。

## 本地快速启动（仅模拟模型）

在仓库根目录分别打开两个 PowerShell 终端：

Worker：

~~~powershell
$env:WRANGLER_SEND_METRICS='false'
pnpm --filter @ai-tool-chat/worker exec wrangler dev --local --ip 127.0.0.1 --port 8789 --var ENVIRONMENT:development --var ALLOWED_ORIGINS:http://127.0.0.1:5177 --var ALLOW_REGISTRATION:true --var MOCK_MODEL:true
~~~

前端：

~~~powershell
$env:VITE_API_URL='http://127.0.0.1:8789'
pnpm --filter @ai-tool-chat/frontend exec vite --host 127.0.0.1 --port 5177 --strictPort
~~~

打开 http://127.0.0.1:5177，点击创建新账户；密码至少12位。本地模拟输出明确标为模拟，不调用真实模型。首次安装依赖使用 pnpm install --frozen-lockfile。

基础冒烟：python scripts/smoke-workspace.py，结果与截图在 generated/basic-smoke/。该脚本只访问固定 localhost 并创建合成测试账户/资料。

## 本轮验证强度

按用户最后要求，以编译/类型检查、关键模块定向测试与一条本地端到端冒烟收尾；不做最终完整回归、压力测试、故障注入或真实模型付费评测。此前模块开发有各自单元测试，不能替代生产验收。

最终基础流程验证：注册登录、模拟聊天、文件上传合并、持久文件任务、snapshot来源、刷新打开任务、引用按钮、390px无横向溢出；真实模型调用0次。Worker dry-run仅打包检查，不是部署。

## 重要行为与限制

- 普通断网/页面刷新：重新读取同一任务的进度与结果，不重新调用模型。运行实例在已经开始模型调用后异常丢失：保留输出并标记中断，由用户确认后重新提交；不承诺从模型生成的某个token无缝续算。
- 文件以服务端SHA256绑定版本；删除并重传后，旧任务遇到版本变化会明确失败，不能偷偷读取新内容。
- 多标签页带预期账户ID，账号切换后旧页面不能把旧历史提交给新账户。
- 引用使用提取文本行号和原文片段，不伪造PDF页码；支持原有文本/代码文件类型，不新增PDF OCR/视频处理。大文件使用有预算的检索/代表性片段，不宣称阅读全文。
- 固定30题只验证离线检索与引用完整性，不代表模型回答正确率。生成质量需要后续经批准使用真实模型评测。
- token预算包含预留及保守估算。供应商未返回完整usage时会标estimated或unknown，中断未知用量不当免费。
- MODEL_PRICES_JSON可由管理员配置各模型 inputPerMillion/outputPerMillion/currency；未配置则费用unknown，配置后也只显示估算，非实际账单，不含缓存折扣、税费等。
- 注册默认为关闭。没有邮箱验证或找回密码；首次生产开通账户/注册策略需在部署前确定。
- 旧匿名历史留在原浏览器键中但不会自动分配给新账户；旧无归属文件不能自动认领，需受控迁移或重新上传。
- 文件可主动删除；未完成的过期上传需在文件列表清理释放额度。账户目录一期为单个DO，尚未做高并发验证。

## 发布前

需单独批准前端/Worker发布、新AccountDirectory/DurableTask迁移与生产注册策略。保留旧worker/前端版本和原R2数据。按实际生产域名配置ALLOWED_ORIGINS，严禁在生产启用本地模拟配置或匿名降级。
