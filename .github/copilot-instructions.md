# Git Commit Message Instructions

生成 Git commit message 时，默认使用中文，并遵守 Conventional Commits。

要求：

1. 保留 Conventional Commits 前缀，例如：`feat`、`fix`、`refactor`、`docs`、`chore`、`test`、`build`、`ci`
2. 格式固定为：`type: 中文描述`
3. 冒号后必须是简洁明确的中文
4. 默认只输出一行，不要附加解释
5. 除非用户明确要求英文，否则不要生成英文 commit message

示例：

- `feat: 新增用户登录校验`
- `fix: 修复聊天记录切换异常`
- `refactor: 重构消息发送逻辑`
- `docs: 补充项目部署说明`
