import { describe, expect, it } from 'vitest';
import { createMockEnv } from '../test/mocks';
import { selectSkill } from './index';

describe('selectSkill', () => {
  it('纯文本请求应选择文本技能和默认文本模型', () => {
    const selectedSkill = selectSkill(
      { messages: [{ role: 'user', content: '你好' }] },
      createMockEnv({ DEFAULT_MODEL: 'qwen-plus' }),
    );

    expect(selectedSkill.skill.name).toBe('text-chat');
    expect(selectedSkill.model).toBe('qwen-plus');
  });

  it('带文件请求应选择文件技能并优先使用文件默认模型', () => {
    const selectedSkill = selectSkill(
      {
        messages: [{ role: 'user', content: '分析文件' }],
        files: [{
          fileId: 'f1',
          fileName: 'demo.txt',
          mimeType: 'text/plain',
          size: 1,
          fileHash: 'hash',
          source: 'uploaded',
        }],
      },
      createMockEnv({
        DEFAULT_MODEL: 'qwen-plus',
        DEFAULT_FILE_MODEL: 'qwen-long',
      }),
    );

    expect(selectedSkill.skill.name).toBe('file-chat');
    expect(selectedSkill.model).toBe('qwen-long');
  });

  it('带图片请求应选择多模态技能和默认图片模型', () => {
    const selectedSkill = selectSkill(
      {
        messages: [{ role: 'user', content: '看看图片' }],
        images: [{ id: 'img-1', base64: 'abc', mimeType: 'image/png' }],
      },
      createMockEnv({ DEFAULT_MULTIMODAL_MODEL: 'qwen-vl-max' }),
    );

    expect(selectedSkill.skill.name).toBe('multimodal-chat');
    expect(selectedSkill.model).toBe('qwen-vl-max');
  });
});
