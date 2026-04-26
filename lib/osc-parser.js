'use strict';

// OSC 7 序列: ESC ] 7 ; file://<hostname>/<path> BEL
// hostname 可空(file:///path), path 以 / 开头, 终止符是 BEL(\x07)
// 也兼容 ST (ESC \) 终止: \x1b]7;...\x1b\\
//
// 我们只关心 file://...path 中的 path 部分。
const OSC7_RE = /\x1b\]7;file:\/\/[^/\x07\x1b]*(\/[^\x07\x1b]*)(?:\x07|\x1b\\)/g;

/**
 * 从一段 PTY 输出中提取最新的 cwd (OSC 7)。
 * 没有命中返回 null。多个命中返回最后一个 (最新状态)。
 *
 * @param {string} chunk
 * @returns {string|null}
 */
function parseOsc7(chunk) {
  if (typeof chunk !== 'string' || chunk.length === 0) return null;
  let last = null;
  let m;
  // 重置 lastIndex 防止 stateful regex 出错
  OSC7_RE.lastIndex = 0;
  while ((m = OSC7_RE.exec(chunk)) !== null) {
    try {
      // 路径里如果有 percent-encoded 字符 (中文路径常见) 解码
      last = decodeURIComponent(m[1]);
    } catch {
      last = m[1];
    }
  }
  return last;
}

module.exports = { parseOsc7 };
