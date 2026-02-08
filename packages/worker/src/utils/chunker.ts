/**
 * 文件分块处理工具
 *
 * 用于将大文本文件按 token 数量分割成多个小块
 * 采用 Map-Reduce 风格的分块处理
 */

// ==================== Token 估算 ====================

/**
 * 估算文本的 token 数量
 * 简单方案：中文 1.5 字符/token，英文 4 字符/token
 *
 * @param text - 要估算的文本
 * @returns 估算的 token 数量
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;

  // 统计中文字符和 ASCII 字符
  let chineseChars = 0;
  let asciiChars = 0;

  for (let i = 0; i < text.length; i++) {
    const charCode = text.charCodeAt(i);
    // 中文字符范围（包括全角符号等）
    if (charCode > 0x7F) {
      chineseChars++;
    } else {
      asciiChars++;
    }
  }

  // 中文约 1.5 字符/token，英文约 4 字符/token
  const chineseTokens = Math.ceil(chineseChars / 1.5);
  const asciiTokens = Math.ceil(asciiChars / 4);

  return chineseTokens + asciiTokens;
}

// ==================== 分块 ====================

/**
 * 按照指定最大 token 数量分割文本
 * 优先在自然断点（换行、段落等）处分割
 *
 * @param text - 要分割的文本
 * @param maxTokens - 每块最大 token 数
 * @returns 分块后的文本数组
 */
export function splitByTokens(text: string, maxTokens: number): string[] {
  if (!text || estimateTokens(text) <= maxTokens) {
    return text ? [text] : [];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    // 先按字符估算需要分割的位置
    const targetTokens = Math.min(maxTokens, estimateTokens(remaining));
    const estimatedChars = Math.floor(targetTokens * 3); // 平均 3 字符/token

    // 找到安全的分割点
    const splitPoint = findSafeSplitPoint(remaining, estimatedChars);

    // 提取这一块
    const chunk = remaining.substring(0, splitPoint).trim();
    if (chunk) {
      chunks.push(chunk);
    }

    // 移除已处理的部分
    remaining = remaining.substring(splitPoint);
  }

  return chunks;
}

/**
 * 寻找安全的文本分割点
 * 优先级：双换行 > 单换行 > 标点符号 > 空格
 *
 * @param text - 文本
 * @param targetPosition - 目标分割位置
 * @returns 安全的分割点位置
 */
export function findSafeSplitPoint(text: string, targetPosition: number): number {
  const maxLookAhead = 500; // 最多向前查找 500 个字符
  const maxLookBehind = 200; // 最多向后查找 200 个字符

  // 目标位置超出文本长度
  if (targetPosition >= text.length) {
    return text.length;
  }

  // 在目标位置前后搜索安全分割点
  let searchStart = Math.max(0, targetPosition - maxLookBehind);
  let searchEnd = Math.min(text.length, targetPosition + maxLookAhead);

  // 优先级 1: 双换行（段落分隔）
  let bestPoint = findPattern(text, searchStart, searchEnd, /\n\n+/);
  if (bestPoint !== -1) {
    return bestPoint + 2; // 包含第一个 \n
  }

  // 优先级 2: 单换行
  bestPoint = findPattern(text, searchStart, searchEnd, /\n/);
  if (bestPoint !== -1) {
    return bestPoint + 1;
  }

  // 优先级 3: 句号、问号、感叹号（句子结束）
  bestPoint = findPattern(text, searchStart, searchEnd, /[。!！.？\?]/);
  if (bestPoint !== -1) {
    return bestPoint + 1;
  }

  // 优先级 4: 逗号、分号
  bestPoint = findPattern(text, searchStart, searchEnd, /[，,;；]/);
  if (bestPoint !== -1) {
    return bestPoint + 1;
  }

  // 优先级 5: 空格
  bestPoint = findPattern(text, searchStart, searchEnd, /\s+/);
  if (bestPoint !== -1) {
    return bestPoint + 1;
  }

  // 都没找到，直接在目标位置分割
  return targetPosition;
}

/**
 * 在文本范围内查找模式，返回最接近目标位置的匹配
 *
 * @param text - 文本
 * @param start - 搜索起始位置
 * @param end - 搜索结束位置
 * @param pattern - 正则表达式模式
 * @returns 匹配位置，-1 表示未找到
 */
function findPattern(text: string, start: number, end: number, pattern: RegExp): number {
  let bestPoint = -1;
  let minDistance = Infinity;
  const target = (start + end) / 2;

  let match;
  const regex = new RegExp(pattern.source, pattern.flags + 'g');

  while ((match = regex.exec(text)) !== null) {
    const pos = match.index;
    if (pos >= start && pos <= end) {
      const distance = Math.abs(pos - target);
      if (distance < minDistance) {
        minDistance = distance;
        bestPoint = pos;
      }
    }
  }

  return bestPoint;
}

// ==================== 上下文保留 ====================

/**
 * 为分块添加上下文
 * 在每块前后保留少量上下文行，避免丢失关键信息
 *
 * @param chunks - 原始分块
 * @param contextLines - 保留的上下文行数
 * @returns 带上下文的分块
 */
export function addContextToChunks(chunks: string[], contextLines: number = 50): string[] {
  if (chunks.length <= 1) {
    return chunks;
  }

  const result: string[] = [];

  for (let i = 0; i < chunks.length; i++) {
    let chunk = chunks[i];

    // 为第一个块添加后置上下文
    if (i === 0 && chunks.length > 1) {
      const nextChunkLines = chunks[1].split('\n');
      const context = nextChunkLines.slice(0, contextLines).join('\n');
      chunk += '\n\n[后续上下文]\n' + context;
    }

    // 为最后一个块添加前置上下文
    if (i === chunks.length - 1 && chunks.length > 1) {
      const prevChunkLines = chunks[chunks.length - 2].split('\n');
      const context = prevChunkLines.slice(-contextLines).join('\n');
      chunk = '[前置上下文]\n' + context + '\n\n' + chunk;
    }

    // 为中间块添加前后上下文
    if (i > 0 && i < chunks.length - 1) {
      const prevChunkLines = chunks[i - 1].split('\n');
      const prevContext = prevChunkLines.slice(-contextLines).join('\n');

      const nextChunkLines = chunks[i + 1].split('\n');
      const nextContext = nextChunkLines.slice(0, contextLines).join('\n');

      chunk = '[前置上下文]\n' + prevContext + '\n\n' + chunk + '\n\n[后续上下文]\n' + nextContext;
    }

    result.push(chunk);
  }

  return result;
}
