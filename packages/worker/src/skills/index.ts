/**
 * Skill 注册中心
 */
import type { Skill, SkillType } from '../types';
import { textSkill } from './textSkill';
import { multimodalSkill } from './multimodalSkill';

// Skill 注册表
const skillRegistry = new Map<string, Skill>();

// 注册默认 Skills
export function registerDefaultSkills(): void {
  registerSkill(textSkill);
  registerSkill(multimodalSkill);
}

/**
 * 注册 Skill
 */
export function registerSkill(skill: Skill): void {
  skillRegistry.set(skill.name, skill);
  console.log(`[Skill] Registered: ${skill.name} (${skill.type})`);
}

/**
 * 获取 Skill
 */
export function getSkill(name: string): Skill | undefined {
  return skillRegistry.get(name);
}

/**
 * 根据输入自动选择合适的 Skill
 */
export function selectSkill(input: { images?: unknown[]; files?: unknown[] }): Skill {
  const { images = [], files = [] } = input;

  // 如果有图片，使用多模态 Skill
  if (images.length > 0) {
    return multimodalSkill;
  }

  // 默认使用文本 Skill
  return textSkill;
}

/**
 * 列出所有可用的 Skills
 */
export function listSkills(): Skill[] {
  return Array.from(skillRegistry.values());
}

// 初始化
registerDefaultSkills();
