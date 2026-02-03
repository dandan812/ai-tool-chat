/**
 * Skill 注册中心 / Skill Registry
 * 
 * 作用：
 *   1. 统一管理所有可用的 Skill（技能）
 *   2. 提供 Skill 的注册、获取、选择功能
 *   3. 实现 Skill 的动态发现和自动选择
 * 
 * 什么是 Skill？
 *   Skill 是一个可插拔的 AI 能力模块，比如：
 *   - textSkill：处理纯文本对话
 *   - multimodalSkill：处理图文对话
 *   - codeSkill：处理代码相关任务（未来可扩展）
 */
import type { Skill, SkillType } from '../types';
import { textSkill } from './textSkill';
import { multimodalSkill } from './multimodalSkill';
import { fileSkill, isSupportedTextFile } from './fileSkill';

/**
 * Skill 注册表
 * 使用 Map 存储，key 是 skill.name，value 是 Skill 对象
 * 
 * 为什么不直接用对象？
 *   Map 有更好的性能，支持任意类型的 key，API 更清晰
 */
const skillRegistry = new Map<string, Skill>();

/**
 * 注册默认的 Skills
 * 
 * 在系统启动时调用，将所有内置 Skill 注册到注册表
 * 以后添加新 Skill，只需要在这里加一行 registerSkill(newSkill)
 */
export function registerDefaultSkills(): void {
  registerSkill(textSkill);       // 注册文本对话技能
  registerSkill(multimodalSkill); // 注册图文对话技能
}

/**
 * 注册单个 Skill
 * @param skill - 要注册的 Skill 对象
 * 
 * 使用示例：
 *   registerSkill({
 *     name: 'code-review',
 *     type: 'code',
 *     description: '代码审查技能',
 *     execute: async function* (input, context) { ... }
 *   })
 */
export function registerSkill(skill: Skill): void {
  skillRegistry.set(skill.name, skill);
  console.log(`[Skill] Registered: ${skill.name} (${skill.type})`);
}

/**
 * 通过名称获取 Skill
 * @param name - Skill 的名称（如 'text-chat'）
 * @returns Skill 对象，如果没找到返回 undefined
 * 
 * 使用场景：
 *   当明确知道要用哪个 Skill 时直接获取
 */
export function getSkill(name: string): Skill | undefined {
  return skillRegistry.get(name);
}

/**
 * 根据输入自动选择合适的 Skill（核心智能选择逻辑）
 * @param input - 输入数据，包含 images（图片数组）、files（文件数组）
 * @returns 最适合处理该输入的 Skill
 * 
 * 选择策略（优先级）：
 *   1. 如果有图片 → 使用 multimodalSkill（多模态）
 *   2. 如果有文件 → 未来可以使用 fileSkill
 *   3. 默认 → textSkill（纯文本）
 * 
 * 为什么这样设计？
 *   自动选择让用户无需关心底层使用哪个 AI 模型，
 *   系统根据输入类型智能匹配最佳处理能力
 */
export function selectSkill(input: { images?: unknown[]; files?: unknown[] }): Skill {
  const { images = [], files = [] } = input;

  // 规则 1：如果有图片，使用多模态 Skill
  if (images.length > 0) {
    return multimodalSkill;
  }

  // 规则 2：未来可以扩展文件处理
  // if (files.length > 0) {
  //   return fileSkill;
  // }

  // 默认规则：纯文本对话
  return textSkill;
}

/**
 * 列出所有已注册的 Skills
 * @returns Skill 对象数组
 * 
 * 使用场景：
 *   - 管理后台展示可用技能
 *   - 调试时查看注册了哪些 Skill
 */
export function listSkills(): Skill[] {
  return Array.from(skillRegistry.values());
}

/**
 * 模块初始化
 * 
 * 当这个文件被 import 时，自动执行注册
 * 确保系统启动时所有 Skill 都已就绪
 */
registerDefaultSkills();
