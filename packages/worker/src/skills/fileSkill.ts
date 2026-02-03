/**
 * 文件处理 Skill
 * 
 * 处理文本类文件（txt, md, csv, json, 代码文件等）
 * 将文件内容读取后拼接到用户消息中
 * 
 * 注意：DeepSeek 本身不直接支持文件上传，
 * 这个 Skill 是将文件内容作为文本插入到对话中
 */
import type { Skill, SkillInput, SkillContext, SkillStreamChunk } from '../types';
import { textSkill } from './textSkill';
import { logger } from '../utils/logger';

export const fileSkill: Skill = {
  name: 'file-chat',
  type: 'text',  // 最终还是文本对话
  description: '处理文本文件对话（txt, md, csv, json, 代码文件等）',

  async *execute(input: SkillInput, context: SkillContext): AsyncIterable<SkillStreamChunk> {
    const { files = [], messages } = input;

    logger.info('Processing files', { fileCount: files.length });

    // 构建包含文件内容的提示词
    const fileContents = files.map(file => {
      // 根据文件类型添加标记
      const ext = file.name.split('.').pop() || '';
      return `### 文件: ${file.name}\n\`\`\`${ext}\n${file.content}\n\`\`\``;
    }).join('\n\n');

    // 获取最后一条用户消息
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    const userQuestion = lastUserMsg?.content || '请分析这些文件';

    // 构建新的消息列表，将文件内容作为上下文
    const enhancedMessages = [
      // 系统提示词
      {
        role: 'system' as const,
        content: '你是一个文件分析助手。用户会上传一些文本文件，请根据文件内容回答用户的问题。'
      },
      // 文件内容作为上下文
      {
        role: 'user' as const,
        content: `以下是我上传的文件内容：\n\n${fileContents}\n\n我的问题是：${userQuestion}`
      }
    ];

    // 复用 textSkill 进行对话
    const textInput = { ...input, messages: enhancedMessages };
    yield* textSkill.execute(textInput, context);
  }
};

/**
 * 检查是否是支持的文本文件
 */
export function isSupportedTextFile(filename: string): boolean {
  const supportedExts = [
    'txt', 'md', 'markdown',
    'csv', 'json', 'xml', 'yaml', 'yml',
    'js', 'ts', 'jsx', 'tsx',
    'py', 'java', 'c', 'cpp', 'h', 'hpp',
    'html', 'css', 'scss', 'less',
    'go', 'rs', 'rb', 'php', 'swift', 'kt',
    'sql', 'sh', 'bash', 'ps1',
    'log', 'conf', 'ini', 'env'
  ];
  
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return supportedExts.includes(ext);
}
