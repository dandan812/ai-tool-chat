const BAILIAN_MODEL_PREFIXES = [
  "qwen",
  "qwen3",
  "qwen-vl",
  "qwen3-vl",
  "kimi",
  "minimax",
];

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

export {
  DEFAULT_QWEN_FILE_MODEL,
  DEFAULT_QWEN_MULTIMODAL_MODEL,
  DEFAULT_QWEN_TEXT_MODEL,
  resolveDefaultFileModel,
  resolveDefaultModelConfig,
  resolveDefaultMultimodalModel,
  resolveDefaultTextModel,
} from './defaultModels';
