import type { Env } from "../types";

export const DEFAULT_QWEN_TEXT_MODEL = "glm-5";
export const DEFAULT_QWEN_MULTIMODAL_MODEL = "qwen-vl-plus";
export const DEFAULT_QWEN_FILE_MODEL = DEFAULT_QWEN_TEXT_MODEL;

type DefaultModelEnv = Pick<
  Env,
  "DEFAULT_MODEL" | "DEFAULT_FILE_MODEL" | "DEFAULT_MULTIMODAL_MODEL" | "QWEN_API_KEY"
>;

export interface DefaultModelConfig {
  text: string;
  file: string;
  multimodal: string;
}

/**
 * 统一维护三类默认模型的解析规则。
 *
 * 这里的职责只有一件事：把环境变量和项目内置回退值整理成
 * text / file / multimodal 三类明确的默认模型，避免各处各写一套判断。
 */
export function resolveDefaultModelConfig(env?: Partial<DefaultModelEnv>): DefaultModelConfig {
  const text = resolveDefaultTextModel(env);

  return {
    text,
    file: resolveDefaultFileModel(env, text),
    multimodal: resolveDefaultMultimodalModel(env),
  };
}

/**
 * 文本模型默认值仍然兼容历史行为：
 * 显式配置优先，否则回退到项目内置默认文本模型。
 */
export function resolveDefaultTextModel(env?: Partial<DefaultModelEnv>): string {
  if (env?.DEFAULT_MODEL?.trim()) {
    return env.DEFAULT_MODEL.trim();
  }

  if (env?.QWEN_API_KEY) {
    return DEFAULT_QWEN_TEXT_MODEL;
  }

  return DEFAULT_QWEN_TEXT_MODEL;
}

/**
 * 文件模型允许独立配置，但为了兼容老环境，
 * 未配置 DEFAULT_FILE_MODEL 时仍回退到文本默认模型。
 */
export function resolveDefaultFileModel(
  env?: Partial<DefaultModelEnv>,
  resolvedTextModel?: string,
): string {
  if (env?.DEFAULT_FILE_MODEL?.trim()) {
    return env.DEFAULT_FILE_MODEL.trim();
  }

  return resolvedTextModel ?? resolveDefaultTextModel(env);
}

/**
 * 图片模型继续独立维护，默认回退到多模态模型内置值。
 */
export function resolveDefaultMultimodalModel(env?: Partial<DefaultModelEnv>): string {
  if (env?.DEFAULT_MULTIMODAL_MODEL?.trim()) {
    return env.DEFAULT_MULTIMODAL_MODEL.trim();
  }

  return DEFAULT_QWEN_MULTIMODAL_MODEL;
}
