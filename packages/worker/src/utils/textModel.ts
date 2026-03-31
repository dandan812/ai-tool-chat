import type { Env } from "../types";

export const DEFAULT_GLM_TEXT_MODEL = "glm-5";
export const DEFAULT_OPENAI_TEXT_MODEL = "gpt-4.1-mini";
export const DEFAULT_DEEPSEEK_TEXT_MODEL = "deepseek-chat";
export const DEFAULT_QWEN_TEXT_MODEL = "qwen3.5-flash-2026-02-23";
export const DEFAULT_QWEN_MULTIMODAL_MODEL = "qwen3.5-plus";

type TextEnv = Pick<
  Env,
  "DEFAULT_MODEL" | "GLM_API_KEY" | "OPENAI_API_KEY" | "DEEPSEEK_API_KEY" | "QWEN_API_KEY"
>;

type MultimodalEnv = Pick<Env, "DEFAULT_MULTIMODAL_MODEL">;

/**
 * 统一解析默认文本模型。
 * 规则：
 * 1. 优先使用显式配置的 DEFAULT_MODEL
 * 2. 否则按可用供应商选择内置默认模型
 * 3. 最终兜底为 GLM 默认模型
 */
export function resolveDefaultTextModel(env?: Partial<TextEnv>): string {
  if (env?.DEFAULT_MODEL?.trim()) {
    return env.DEFAULT_MODEL.trim();
  }

  if (env?.GLM_API_KEY) {
    return DEFAULT_GLM_TEXT_MODEL;
  }

  if (env?.OPENAI_API_KEY) {
    return DEFAULT_OPENAI_TEXT_MODEL;
  }

  if (env?.DEEPSEEK_API_KEY) {
    return DEFAULT_DEEPSEEK_TEXT_MODEL;
  }

  if (env?.QWEN_API_KEY) {
    return DEFAULT_QWEN_TEXT_MODEL;
  }

  return DEFAULT_GLM_TEXT_MODEL;
}

/**
 * 统一解析默认图片模型。
 */
export function resolveDefaultMultimodalModel(env?: Partial<MultimodalEnv>): string {
  if (env?.DEFAULT_MULTIMODAL_MODEL?.trim()) {
    return env.DEFAULT_MULTIMODAL_MODEL.trim();
  }

  return DEFAULT_QWEN_MULTIMODAL_MODEL;
}

export function isOpenAITextModel(model: string): boolean {
  return model.startsWith("gpt-") || model.startsWith("o");
}

export function isQwenTextModel(model: string): boolean {
  return model.startsWith("qwen");
}

export function isDeepSeekTextModel(model: string): boolean {
  return model.startsWith("deepseek");
}

export function isGlmTextModel(model: string): boolean {
  return model.startsWith("glm");
}
