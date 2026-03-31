import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyThemeAttribute,
  DEFAULT_THEME_OPTIONS,
  getSystemTheme,
  resolveInitialThemeState,
  resolveThemeOptions,
  writeStoredTheme,
} from './themeCore';

describe('themeCore', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.className = '';
  });

  it('应该返回完整的默认配置', () => {
    expect(resolveThemeOptions()).toEqual(DEFAULT_THEME_OPTIONS);
  });

  it('应该优先读取本地存储中的主题偏好', () => {
    writeStoredTheme(DEFAULT_THEME_OPTIONS.storageKey, 'dark');

    const state = resolveInitialThemeState(DEFAULT_THEME_OPTIONS, 'light');

    expect(state).toEqual({
      theme: 'dark',
      followsSystem: false,
    });
  });

  it('应该在 system 模式下跟随系统主题', () => {
    writeStoredTheme(DEFAULT_THEME_OPTIONS.storageKey, 'system');

    const state = resolveInitialThemeState(DEFAULT_THEME_OPTIONS, 'dark');

    expect(state).toEqual({
      theme: 'dark',
      followsSystem: true,
    });
  });

  it('应该把主题应用到根节点并添加过渡类名', () => {
    vi.useFakeTimers();

    applyThemeAttribute('data-theme', 'dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.classList.contains('theme-transition')).toBe(true);

    vi.advanceTimersByTime(300);
    expect(document.documentElement.classList.contains('theme-transition')).toBe(false);

    vi.useRealTimers();
  });

  it('应该按 matchMedia 结果返回系统主题', () => {
    const matchMedia = vi.fn().mockReturnValue({ matches: true });
    vi.stubGlobal('window', { ...window, matchMedia });

    expect(getSystemTheme()).toBe('dark');
  });
});
