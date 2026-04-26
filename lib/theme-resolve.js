'use strict';

// 已知主题名（4 套）
const KNOWN_THEMES = ['warm-beige', 'dark-mocha', 'paper-white', 'midnight'];
const DEFAULT_THEME = 'warm-beige';
const AUTO_DARK = 'dark-mocha';
const AUTO_LIGHT = 'warm-beige';

/**
 * 把 (用户偏好, 系统是否 dark) 解析成实际生效的主题名。
 *
 * 规则：
 * - 用户偏好 = 'auto' → 看系统：dark → dark-mocha；light → warm-beige
 * - 用户偏好 = 已知主题名 → 原样返回（无视系统）
 * - 用户偏好 = 未知值 / null / undefined → fallback 'warm-beige'
 *
 * @param {string} preference - 'auto' | 'warm-beige' | 'dark-mocha' | 'paper-white' | 'midnight' | 其他
 * @param {boolean} systemDark - 系统是否处于 dark mode
 * @returns {string}
 */
function resolveTheme(preference, systemDark) {
  if (preference === 'auto') {
    return systemDark ? AUTO_DARK : AUTO_LIGHT;
  }
  if (KNOWN_THEMES.indexOf(preference) >= 0) {
    return preference;
  }
  return DEFAULT_THEME;
}

module.exports = { resolveTheme, KNOWN_THEMES, DEFAULT_THEME, AUTO_DARK, AUTO_LIGHT };
