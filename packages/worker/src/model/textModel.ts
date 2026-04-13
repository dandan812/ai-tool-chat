import type { Env } from "../types";

export const DEFAULT_QWEN_TEXT_MODEL = "qwen3.5-flash-2026-02-23";
export const DEFAULT_QWEN_MULTIMODAL_MODEL = "qwen-vl-plus";

type TextEnv = Pick<Env, "DEFAULT_MODEL" | "QWEN_API_KEY">;

type MultimodalEnv = Pick<Env, "DEFAULT_MULTIMODAL_MODEL">;

const BAILIAN_MODEL_PREFIXES = [
  "qwen",
  "qwen3",
  "qwen-vl",
  "qwen3-vl",
  "kimi",
  "minimax",
];

/**
 * 统一解析默认文本模型。
 *
 * 当前项目已经明确只保留阿里云百炼这一条模型链路，
 * 因此这里不再根据多个上游厂商兜底，只判断：
 * 1. 是否显式配置了 DEFAULT_MODEL
 * 2. 是否存在可用的百炼 API Key
 *
 * 这样可以避免没有传模型时又意外回退到旧的多供应商默认值。
 */
export function resolveDefaultTextModel(env?: Partial<TextEnv>): string {
  if (env?.DEFAULT_MODEL?.trim()) {
    return env.DEFAULT_MODEL.trim();
  }

  if (env?.QWEN_API_KEY) {
    return DEFAULT_QWEN_TEXT_MODEL;
  }

  return DEFAULT_QWEN_TEXT_MODEL;
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

/**
 * 百炼的兼容接口不只承载 Qwen，也可能承载 Kimi、MiniMax 等模型。
 * 这里统一按“百炼模型前缀”判断，避免再把模型路由逻辑和具体上游厂商强绑定。
 */
export function isBailianTextModel(model: string): boolean {
  const normalizedModel = model.trim().toLowerCase();
  return BAILIAN_MODEL_PREFIXES.some((prefix) => normalizedModel.startsWith(prefix));
}

export function getTextModelProviderLabel(model: string): string {
  if (isBailianTextModel(model)) {
    return '百炼';
  }

  return '文本';
}
