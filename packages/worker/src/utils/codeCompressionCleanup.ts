import type { LanguageConfig } from './codeCompressionTypes';

export function removeComments(code: string, config: LanguageConfig): string {
  let result = removeMultiLineComments(code, config.multiLineComment[0], config.multiLineComment[1]);
  result = result.replace(config.singleLineComment, '');
  return result;
}

export function removeExtraLines(code: string): string {
  return code.replace(/\n{3,}/g, '\n\n').trim();
}

function removeMultiLineComments(code: string, startPattern: RegExp, endPattern: RegExp): string {
  let result = '';
  let index = 0;

  while (index < code.length) {
    const startMatch = code.substring(index).match(startPattern);
    if (startMatch && startMatch.index !== undefined) {
      index += startMatch.index + startMatch[0].length;

      const endMatch = code.substring(index).match(endPattern);
      if (endMatch && endMatch.index !== undefined) {
        index += endMatch.index + endMatch[0].length;
      } else {
        break;
      }
    } else {
      result += code[index];
      index++;
    }
  }

  return result;
}
