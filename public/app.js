import htm from 'https://cdn.jsdelivr.net/npm/htm@3.1.1/dist/htm.module.js';

const html = htm.bind(React.createElement);
const { useState, useEffect, useRef, useCallback, useMemo } = React;

// ===== Helpers =====
const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
const modKey = isMac ? '\u2318' : 'Ctrl';

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

async function apiFetch(url, opts = {}) {
  const res = await fetch(url, opts);
  if (!res.ok) {
    const text = await res.text().catch(() => 'Unknown error');
    throw new Error(`${res.status}: ${text}`);
  }
  return res.json();
}

// ===== Toast System =====
let _toastId = 0;
function useToasts() {
  const [toasts, setToasts] = useState([]);
  const addToast = useCallback((text, type = 'info', duration = 4000) => {
    const id = ++_toastId;
    setToasts(prev => [...prev, { id, text, type }]);
    if (duration > 0) setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), duration);
    return id;
  }, []);
  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);
  return { toasts, addToast, removeToast };
}

// ===== Custom Select (replaces native <select> for consistent font rendering) =====
function CustomSelect({ value, onChange, options, placeholder }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const selected = options.find(o => o.value === value);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return html`
    <div class="custom-select ${open ? 'open' : ''}" ref=${ref}>
      <button type="button" class="custom-select-trigger" onClick=${() => setOpen(!open)}>
        <span>${selected ? selected.label : (placeholder || 'Select...')}</span>
        <svg width="12" height="12" viewBox="0 0 12 12"><path fill="#8a847a" d="M6 8L1 3h10z"/></svg>
      </button>
      ${open && html`
        <div class="custom-select-menu">
          ${options.map(o => html`
            <div key=${o.value}
              class="custom-select-option ${o.value === value ? 'selected' : ''}"
              onClick=${() => { onChange(o.value); setOpen(false); }}>
              ${o.label}
            </div>
          `)}
        </div>
      `}
    </div>
  `;
}

// ===== Terminal Highlights (in-session visual anchors) =====
// Cmd/Ctrl+Shift+L on a terminal selection toggles a warm amber highlight.
// In-memory only: highlights persist within the current session/attach, but
// drop when the session is closed, the page reloads, or the terminal is
// cleared/rewritten (TUI apps, alt buffer, clear command, etc.).
// The `absY` we store is a buffer-local absolute row, which is not stable
// across new Terminal instances — so restoring from localStorage across
// re-attach would land on wrong rows. That path is intentionally omitted.
const HL_HEX = '#FFF797';

// Coord system (verified by live test on xterm 5.5.0):
//   getSelectionPosition().start/end: 0-based; start inclusive; end.x exclusive,
//   end.y inclusive on the last selected row.
//   buffer.active.baseY/cursorY: 0-based. registerDecoration.x: 0-based.
// All one system — no normalization needed.
function buildHighlightLines(term, sel) {
  const lines = [];
  const startY = sel.start.y;
  const endY = sel.end.y;
  for (let y = startY; y <= endY; y++) {
    const x = (y === startY) ? sel.start.x : 0;
    const lastX = (y === endY) ? sel.end.x : term.cols;
    const width = Math.max(1, lastX - x);
    lines.push({ absY: y, x, width });
  }
  return lines;
}

function applyLinesAsHighlight(term, lines) {
  const out = [];
  const buf = term.buffer.active;
  const cursorAbs = buf.baseY + buf.cursorY;
  for (const line of lines) {
    const offset = line.absY - cursorAbs;
    let marker;
    try { marker = term.registerMarker(offset); } catch { continue; }
    if (!marker) continue;
    const deco = term.registerDecoration({
      marker,
      x: line.x,
      width: line.width,
      height: 1,
      backgroundColor: HL_HEX,
      layer: 'bottom',
    });
    if (!deco) { try { marker.dispose(); } catch {} continue; }
    deco.onRender(el => { el.classList.add('hub-highlight'); });
    out.push({ deco, marker });
  }
  return out;
}

// Returns 'added' | 'removed' | 'alt-buffer' | 'no-selection' | 'failed'
function toggleHighlightAtSelection(entry) {
  const { term } = entry;
  if (term.buffer.active.type === 'alternate') return 'alt-buffer';
  const sel = term.getSelectionPosition();
  const text = term.getSelection();
  if (!sel || !text || !text.trim()) return 'no-selection';

  const lines = buildHighlightLines(term, sel);
  entry.highlights = entry.highlights || [];
  const overlapIdx = entry.highlights.findIndex(h =>
    h.lines.some(l => lines.some(nl => nl.absY === l.absY))
  );

  if (overlapIdx >= 0) {
    const [rm] = entry.highlights.splice(overlapIdx, 1);
    rm.decorations.forEach(({ deco, marker }) => {
      try { deco.dispose(); } catch {}
      try { marker.dispose(); } catch {}
    });
    term.clearSelection();
    return 'removed';
  }

  const decorations = applyLinesAsHighlight(term, lines);
  if (decorations.length === 0) return 'failed';
  entry.highlights.push({ lines, decorations });
  // Cap to avoid unbounded marker accumulation in long sessions.
  while (entry.highlights.length > HIGHLIGHT_LIMIT) {
    const oldest = entry.highlights.shift();
    oldest?.decorations?.forEach(d => { try { d.dispose(); } catch (_) {} });
  }
  term.clearSelection();
  return 'added';
}

// ===== OSC 133 Prompt Marks (跳上/下一条命令) =====
// 依赖 shell 集成发送 OSC 133 序列(zsh-vscode、starship 等支持)。
// 没装的话 entry.promptMarks 一直为空,⌘↑/↓ 走 toast 提示。
const PROMPT_MARK_LIMIT = 200;
const HIGHLIGHT_LIMIT = 100;

function recordPromptMark(entry, type, exitCode) {
  const { term } = entry;
  if (!term) return;
  entry.promptMarks = entry.promptMarks || [];

  if (type === 'A') {
    // Prompt 开始 — 记录 marker(buffer 滚动后行号会变,marker 稳定)
    let marker;
    try { marker = term.registerMarker(0); } catch { return; }
    if (!marker) return;
    entry.promptMarks.push({ marker, exitCode: null, decoration: null });
    // 上限保护
    while (entry.promptMarks.length > PROMPT_MARK_LIMIT) {
      const old = entry.promptMarks.shift();
      try { old.decoration && old.decoration.dispose(); } catch {}
      try { old.marker && old.marker.dispose(); } catch {}
    }
  } else if (type === 'D') {
    // 命令结束,带 exit code — 给最后一个 prompt mark 上失败装饰
    const last = entry.promptMarks[entry.promptMarks.length - 1];
    if (!last) return;
    last.exitCode = exitCode;
    if (exitCode != null && exitCode !== 0 && !last.decoration) {
      try {
        const deco = term.registerDecoration({
          marker: last.marker,
          x: 0,
          width: 1,
          height: 1,
          backgroundColor: '#c25d4e',
          layer: 'top',
        });
        if (deco) {
          deco.onRender(el => { el.classList.add('hub-cmd-failed'); });
          last.decoration = deco;
        }
      } catch {}
    }
  }
}

function jumpPrompt(entry, dir, toast) {
  const { term } = entry;
  const marks = entry.promptMarks || [];
  if (!term || marks.length === 0) {
    if (toast) toast('No prompt marks (install shell integration for ⌘↑/⌘↓)', 'info', 2500);
    return;
  }
  // viewport 顶部对应的 buffer 行号
  const buf = term.buffer.active;
  const viewportTopAbs = buf.viewportY;
  // 找到合适的目标 mark
  const lines = marks.map(m => m.marker && !m.marker.isDisposed ? m.marker.line : -1);
  let targetLine = -1;
  if (dir < 0) {
    // 上一条:严格 < viewportTop 的最大 line
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i] >= 0 && lines[i] < viewportTopAbs) { targetLine = lines[i]; break; }
    }
    if (targetLine < 0 && lines.length) {
      // 已经是最早,跳到最早一条
      const valid = lines.filter(l => l >= 0);
      if (valid.length) targetLine = Math.min(...valid);
    }
  } else {
    // 下一条:严格 > viewportTop 的最小 line
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] >= 0 && lines[i] > viewportTopAbs) { targetLine = lines[i]; break; }
    }
    if (targetLine < 0 && lines.length) {
      const valid = lines.filter(l => l >= 0);
      if (valid.length) targetLine = Math.max(...valid);
    }
  }
  if (targetLine < 0) {
    if (toast) toast('No prompt marks', 'info', 1500);
    return;
  }
  try { term.scrollToLine(targetLine); } catch {}
}

// ===== Terminal Themes (4 套) =====
// 语义角色和 CSS 变量保持一致;切换时同时改 xterm options.theme + document.documentElement[data-theme]。
const THEMES = {
  'warm-beige': {
    background: '#f5f3ed',
    foreground: '#3b3833',
    cursor: '#5c574f',
    cursorAccent: '#f5f3ed',
    selectionBackground: '#ddd9d0',
    selectionForeground: '#3b3833',
    black: '#3b3833', red: '#c25d4e', green: '#6b8f71', yellow: '#c49a2a',
    blue: '#5a7a9e', magenta: '#8b6d9e', cyan: '#5a8f8f', white: '#eceae3',
    brightBlack: '#8a847a', brightRed: '#d4685a', brightGreen: '#7da383', brightYellow: '#d4a93a',
    brightBlue: '#6a8ab0', brightMagenta: '#9d7fb0', brightCyan: '#6aa0a0', brightWhite: '#f5f3ed',
  },
  'dark-mocha': {
    background: '#2a2622',
    foreground: '#e8dfd0',
    cursor: '#b8ad9b',
    cursorAccent: '#2a2622',
    selectionBackground: '#4a423a',
    selectionForeground: '#e8dfd0',
    black: '#1a1714', red: '#d68070', green: '#9ec0a4', yellow: '#d4a93a',
    blue: '#8aa8c4', magenta: '#b094c0', cyan: '#8ab8b8', white: '#c8bfae',
    brightBlack: '#6a6258', brightRed: '#e89488', brightGreen: '#b3d3b9', brightYellow: '#e0bd58',
    brightBlue: '#a0bcd8', brightMagenta: '#c4a8d4', brightCyan: '#a0cccc', brightWhite: '#e8dfd0',
  },
  'paper-white': {
    background: '#fbfbfa',
    foreground: '#37352F',
    cursor: '#4a4845',
    cursorAccent: '#fbfbfa',
    selectionBackground: '#d8d8d4',
    selectionForeground: '#1a1817',
    black: '#1a1817', red: '#b8483a', green: '#5a7d60', yellow: '#b88a18',
    blue: '#456a8e', magenta: '#7a5a8e', cyan: '#48807e', white: '#ebebe8',
    brightBlack: '#7a7672', brightRed: '#c25c4e', brightGreen: '#6b8f71', brightYellow: '#c49a2a',
    brightBlue: '#5a7a9e', brightMagenta: '#8b6d9e', brightCyan: '#5a8f8f', brightWhite: '#fbfbfa',
  },
  'midnight': {
    background: '#0d0d0f',
    foreground: '#cfd0d6',
    cursor: '#9a9ba2',
    cursorAccent: '#0d0d0f',
    selectionBackground: '#33333a',
    selectionForeground: '#cfd0d6',
    black: '#0d0d0f', red: '#c47878', green: '#88b890', yellow: '#c4a040',
    blue: '#88a8b8', magenta: '#a890b8', cyan: '#80b0b0', white: '#a8a9ae',
    brightBlack: '#55565c', brightRed: '#d49090', brightGreen: '#a0c8a8', brightYellow: '#d8b858',
    brightBlue: '#a0bcc8', brightMagenta: '#bca8c8', brightCyan: '#98c4c4', brightWhite: '#cfd0d6',
  },
};

const KNOWN_THEMES = ['warm-beige', 'dark-mocha', 'paper-white', 'midnight'];

// 纯函数:由 (用户偏好, 系统是否 dark) 解析实际生效主题。
// 同源逻辑见 lib/theme-resolve.js (有 node test 覆盖)。
function resolveTheme(preference, systemDark) {
  if (preference === 'auto') return systemDark ? 'dark-mocha' : 'warm-beige';
  if (KNOWN_THEMES.indexOf(preference) >= 0) return preference;
  return 'warm-beige';
}

function getSystemDark() {
  return typeof window !== 'undefined'
    && window.matchMedia
    && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

// ===== WebSocket =====
function createWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return new WebSocket(`${proto}://${location.host}`);
}

// ===== App =====
function App() {
  const [sessions, setSessions] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [showDialog, setShowDialog] = useState(false);
  const [showFilePicker, setShowFilePicker] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [recentDirs, setRecentDirs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [contextMenu, setContextMenu] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [themePref, setThemePref] = useState(() => {
    try { return localStorage.getItem('hub-theme') || 'auto'; } catch { return 'auto'; }
  });
  const [systemDark, setSystemDark] = useState(() => getSystemDark());
  const [termSearchOpen, setTermSearchOpen] = useState(false);
  const { toasts, addToast, removeToast } = useToasts();
  const terminalsRef = useRef({});
  const tabBarRef = useRef(null);
  const prevStatusRef = useRef({});

  // ===== Theme application =====
  // 实际生效主题 = resolveTheme(用户偏好, 系统dark)。同时应用到:
  //   1. document.documentElement[data-theme]  (CSS 变量切换)
  //   2. 所有 active xterm.options.theme        (终端配色切换)
  const activeTheme = useMemo(() => resolveTheme(themePref, systemDark), [themePref, systemDark]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', activeTheme);
    Object.values(terminalsRef.current).forEach(entry => {
      if (entry && entry.term) {
        try { entry.term.options.theme = THEMES[activeTheme]; } catch (e) {}
      }
    });
  }, [activeTheme]);

  // 监听系统 dark mode 变化(只在 themePref=auto 时影响生效主题)
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e) => setSystemDark(e.matches);
    if (mq.addEventListener) mq.addEventListener('change', handler);
    else mq.addListener(handler);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', handler);
      else mq.removeListener(handler);
    };
  }, []);

  const setTheme = useCallback((pref) => {
    setThemePref(pref);
    try { localStorage.setItem('hub-theme', pref); } catch (e) {}
  }, []);

  // Load sessions
  useEffect(() => {
    Promise.all([
      apiFetch('/api/sessions'),
      apiFetch('/api/recent-dirs'),
    ]).then(([data, dirs]) => {
      setSessions(data);
      setRecentDirs(dirs);
      setLoading(false);
    }).catch(err => {
      addToast(`Failed to load sessions: ${err.message}`, 'error');
      setLoading(false);
    });
  }, []);

  // Monitor status changes for notifications
  useEffect(() => {
    sessions.forEach(s => {
      const prev = prevStatusRef.current[s.id];
      if (prev && prev !== s.status && s.id !== activeId) {
        if (s.status === 'idle' && prev === 'active') {
          addToast(html`<span><span class="toast-session-name">${s.name}</span> is waiting for input</span>`, 'attention', 6000);
          // Browser notification
          if (Notification.permission === 'granted') {
            new Notification('Claude Hub', { body: `${s.name} is waiting for input`, silent: false });
          }
        } else if (s.status === 'waiting' && s.needsPermission && prev === 'active') {
          addToast(html`<span>\uD83D\uDD14 <span class="toast-session-name">${s.name}</span> needs permission</span>`, 'attention', 8000);
          if (Notification.permission === 'granted') {
            new Notification('Claude Hub', { body: `\uD83D\uDD14 ${s.name} needs your permission`, silent: false });
          }
        } else if (s.status === 'exited') {
          addToast(html`<span><span class="toast-session-name">${s.name}</span> has exited</span>`, 'error', 5000);
        }
      }
      prevStatusRef.current[s.id] = s.status;
    });
  }, [sessions, activeId]);

  // Request notification permission
  useEffect(() => {
    if (Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (mod && e.key === 't') {
        e.preventDefault();
        setShowDialog(true);
      } else if (mod && e.key === 'w') {
        e.preventDefault();
        if (activeId) closeSession(activeId);
      } else if (mod && e.shiftKey && e.key === '[') {
        e.preventDefault();
        switchTab(-1);
      } else if (mod && e.shiftKey && e.key === ']') {
        e.preventDefault();
        switchTab(1);
      } else if (mod && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const idx = parseInt(e.key) - 1;
        setSessions(prev => {
          if (idx < prev.length) setActiveId(prev[idx].id);
          return prev;
        });
      } else if (mod && e.shiftKey && (e.key === 'L' || e.key === 'l')) {
        // Toggle highlight on active terminal's current selection
        e.preventDefault();
        e.stopPropagation();
        if (!activeId) { addToast('No active session', 'info', 1500); return; }
        const entry = terminalsRef.current[activeId];
        if (!entry || !entry.term) { addToast('Terminal not ready', 'info', 1500); return; }
        const result = toggleHighlightAtSelection(entry);
        if (result === 'added') addToast('Highlighted', 'info', 1500);
        else if (result === 'removed') addToast('Highlight removed', 'info', 1500);
        else if (result === 'alt-buffer') addToast('Cannot highlight in TUI apps (vim/less/etc.)', 'info', 2500);
        else if (result === 'failed') addToast('Highlight failed — try again', 'info', 2000);
        else addToast('Drag to select text first, then ⌘⇧L', 'info', 2500);
      } else if (mod && (e.key === 'f' || e.key === 'F') && !e.shiftKey && !e.altKey) {
        // ⌘F: toggle terminal search bar
        e.preventDefault();
        e.stopPropagation();
        if (!activeId) { addToast('No active session', 'info', 1500); return; }
        setTermSearchOpen(v => !v);
      } else if (mod && e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        // ⌘⇧↑ / ⌘⇧↓: jump to prev/next prompt (OSC 133 marks)
        // Shift required to avoid macOS ⌘↑ (scroll-to-top) collision.
        if (!activeId) return;
        const entry = terminalsRef.current[activeId];
        if (!entry || !entry.term) return;
        e.preventDefault();
        jumpPrompt(entry, e.key === 'ArrowUp' ? -1 : 1, addToast);
      }
    };
    // Capture phase so we beat any terminal/TUI handlers
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [activeId]);

  // Close context menu on click anywhere
  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, [contextMenu]);

  // 切 tab 时自动关闭搜索框
  useEffect(() => { setTermSearchOpen(false); }, [activeId]);

  const switchTab = useCallback((dir) => {
    setSessions(prev => {
      const currentActive = activeId;
      const idx = prev.findIndex(s => s.id === currentActive);
      if (idx === -1 && prev.length > 0) { setActiveId(prev[0].id); return prev; }
      if (idx === -1) return prev;
      const newIdx = (idx + dir + prev.length) % prev.length;
      setActiveId(prev[newIdx].id);
      return prev;
    });
  }, [activeId]);

  // Debounced resize handler
  useEffect(() => {
    const handler = debounce(() => {
      Object.values(terminalsRef.current).forEach(t => {
        if (!t.fitAddon || !t.term) return;
        try {
          t.fitAddon.fit();
          if (t.ws && t.ws.readyState === WebSocket.OPEN) {
            t.ws.send(JSON.stringify({ type: 'resize', cols: t.term.cols, rows: t.term.rows }));
          }
        } catch (e) {}
      });
    }, 100);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  // Re-fit terminals after wake from sleep / tab becomes visible again
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === 'visible') {
        setTimeout(() => {
          Object.entries(terminalsRef.current).forEach(([id, t]) => {
            if (!t.term || !t.fitAddon) return;
            const { term, ws, fitAddon } = t;
            try {
              // Force a size change to trigger full re-layout in both
              // xterm.js and the remote PTY application (SIGWINCH)
              const origCols = term.cols;
              term.resize(origCols - 1, term.rows);
              if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'resize', cols: origCols - 1, rows: term.rows }));
              }
              // Restore correct size after a frame
              requestAnimationFrame(() => {
                try { fitAddon.fit(); } catch (e) {}
                if (ws && ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
                }
                term.refresh(0, term.rows - 1);
                term.scrollToBottom();
              });
            } catch (e) {}
          });
        }, 500);
      }
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, []);

  // Track whether active terminal is scrolled away from bottom
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  useEffect(() => {
    if (!activeId) { setShowScrollBtn(false); return; }
    const check = () => {
      const container = document.getElementById('term-' + activeId);
      if (!container) return;
      const viewport = container.querySelector('.xterm-viewport');
      if (!viewport) return;
      const atBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 10;
      setShowScrollBtn(!atBottom && viewport.scrollHeight > viewport.clientHeight);
    };
    const timer = setInterval(check, 300);
    check();
    return () => clearInterval(timer);
  }, [activeId]);

  const scrollToBottom = useCallback(() => {
    if (!activeId || !terminalsRef.current[activeId]) return;
    terminalsRef.current[activeId].term.scrollToBottom();
  }, [activeId]);

  // Fit + focus active terminal on tab change or sidebar toggle
  useEffect(() => {
    if (!activeId || !terminalsRef.current[activeId]) return;
    const t = terminalsRef.current[activeId];
    const fitMultiple = () => {
      if (t.fitAddon) try { t.fitAddon.fit(); } catch (e) {}
      if (t.term) t.term.focus();
    };
    // Multiple fit attempts to handle layout transitions (sidebar animation, etc.)
    requestAnimationFrame(fitMultiple);
    setTimeout(fitMultiple, 150);
    setTimeout(fitMultiple, 350);
  }, [activeId, sidebarOpen, sidebarWidth]);

  // beforeunload cleanup
  useEffect(() => {
    const handler = () => {
      Object.values(terminalsRef.current).forEach(t => {
        if (t.ws) try { t.ws.close(); } catch (e) {}
      });
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  // Attach terminal
  const attachTerminal = useCallback((sessionId, containerId) => {
    if (terminalsRef.current[sessionId]) return;

    const container = document.getElementById(containerId || `term-${sessionId}`);
    if (!container) {
      // Retry once after animation frame
      requestAnimationFrame(() => {
        const el = document.getElementById(containerId || `term-${sessionId}`);
        if (el) doAttach(sessionId, el);
      });
      return;
    }
    doAttach(sessionId, container);
  }, []);

  function doAttach(sessionId, container) {
    // 现场解析主题(避开 useCallback([]) 闭包锁住旧 activeTheme 的问题)
    let pref = 'auto';
    try { pref = localStorage.getItem('hub-theme') || 'auto'; } catch {}
    const initialTheme = resolveTheme(pref, getSystemDark());

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontSize: 15,
      fontFamily: "'SF Mono', 'Menlo', 'Monaco', 'Courier New', monospace",
      fontWeight: '400',
      fontWeightBold: '600',
      lineHeight: 1.2,
      minimumContrastRatio: 4.5,
      theme: THEMES[initialTheme] || THEMES['warm-beige'],
      allowTransparency: false,
      scrollback: 10000,
      convertEol: true,
      allowProposedApi: true,  // needed for registerMarker / registerDecoration (highlights)
    });

    // 渲染器:用 xterm 默认 DOM renderer。WebGL addon 与 lineHeight=1.2
    // (Obsidian DNA) 不兼容,滚动时 glyph atlas 亚像素误差累积导致乱码。

    const fitAddon = new FitAddon.FitAddon();
    const webLinksAddon = new WebLinksAddon.WebLinksAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);

    // SearchAddon (⌘F)
    let searchAddon = null;
    try {
      if (typeof SearchAddon !== 'undefined' && SearchAddon.SearchAddon) {
        searchAddon = new SearchAddon.SearchAddon();
        term.loadAddon(searchAddon);
      }
    } catch (e) { console.warn('SearchAddon unavailable:', e); }

    // Unicode 11 (emoji / 宽字符宽度修正)
    try {
      if (typeof Unicode11Addon !== 'undefined' && Unicode11Addon.Unicode11Addon) {
        const unicode11 = new Unicode11Addon.Unicode11Addon();
        term.loadAddon(unicode11);
        term.unicode.activeVersion = '11';
      }
    } catch (e) { console.warn('Unicode11Addon unavailable:', e); }

    // OSC 133 prompt 标记 (shell 集成发送 ESC]133;A/B/C/D ST)
    try {
      term.parser.registerOscHandler(133, (data) => {
        // data 形如 "A" / "B" / "C" / "D;<exit_code>"
        const parts = data.split(';');
        const type = parts[0];
        const exitCode = type === 'D' && parts.length > 1 ? parseInt(parts[1], 10) : null;
        const entry = terminalsRef.current[sessionId];
        if (entry) recordPromptMark(entry, type, exitCode);
        return false; // false = 让其他 handler 也能看到
      });
    } catch (e) { console.warn('OSC 133 handler registration failed:', e); }

    const ws = createWS();
    let reconnectTimer = null;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'attach', sessionId, cols: term.cols, rows: term.rows }));
    };

    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.type === 'output') {
        term.write(msg.data);
      } else if (msg.type === 'attached') {
        // pty is ready — fit terminal and send correct size
        try { fitAddon.fit(); } catch (e) {}
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
        // Retry after layout settles
        setTimeout(() => {
          try { fitAddon.fit(); } catch (e) {}
          ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
        }, 300);
      } else if (msg.type === 'status') {
        setSessions(prev => prev.map(s =>
          s.id === msg.sessionId ? { ...s, status: msg.status, needsPermission: msg.needsPermission || false } : s
        ));
        // Clean up spinner artifacts when Claude goes idle
        if (msg.status === 'waiting') {
          requestAnimationFrame(() => {
            try { term.refresh(0, term.rows - 1); } catch (e) {}
          });
        }
      } else if (msg.type === 'error') {
        addToast(msg.message, 'error');
      } else if (msg.type === 'cwd') {
        setSessions(prev => prev.map(s =>
          s.id === msg.sessionId ? { ...s, cwd: msg.cwd } : s
        ));
      }
    };

    ws.onclose = () => {
      setSessions(prev => prev.map(s =>
        s.id === sessionId ? { ...s, status: 'disconnected' } : s
      ));
    };

    ws.onerror = () => {
      // onclose will fire after this
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols, rows }));
      }
    });

    terminalsRef.current[sessionId] = {
      term, ws, fitAddon, searchAddon,
      resizeObserver: null,
      highlights: [],
      promptMarks: [],
    };
    // Debug hatch — lets DevTools reach terminals without React internals
    if (typeof window !== 'undefined') window.__hubTerms = terminalsRef.current;

    term.open(container);

    // Use ResizeObserver for reliable fitting
    const debouncedFit = debounce(() => {
      try {
        fitAddon.fit();
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
        }
      } catch (e) {}
    }, 50);

    const ro = new ResizeObserver(() => debouncedFit());
    ro.observe(container);
    terminalsRef.current[sessionId].resizeObserver = ro;

    // Initial fit - multiple attempts to handle layout settling
    // After each fit, send resize to pty so cols/rows match actual terminal size
    const doFit = () => {
      try {
        fitAddon.fit();
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
        }
      } catch (e) {}
    };
    doFit();
    setTimeout(() => { doFit(); term.focus(); }, 100);
    setTimeout(doFit, 300);
    setTimeout(doFit, 600);
    setTimeout(doFit, 1200);
  }

  // Create session
  const createSession = useCallback(async (name, cwd, args) => {
    try {
      const session = await apiFetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, cwd, args }),
      });
      session.status = 'active';
      setSessions(prev => [...prev, session]);
      setActiveId(session.id);
      setShowDialog(false);
      apiFetch('/api/recent-dirs').then(setRecentDirs).catch(() => {});
      // Attach after render
      requestAnimationFrame(() => {
        requestAnimationFrame(() => attachTerminal(session.id));
      });
    } catch (err) {
      addToast(`Failed to create session: ${err.message}`, 'error');
    }
  }, [attachTerminal, addToast]);

  // Close session
  const closeSession = useCallback(async (id) => {
    if (terminalsRef.current[id]) {
      const t = terminalsRef.current[id];
      if (t.resizeObserver) try { t.resizeObserver.disconnect(); } catch (e) {}
      if (t.promptMarks) {
        t.promptMarks.forEach(m => {
          try { m.decoration && m.decoration.dispose(); } catch {}
          try { m.marker && m.marker.dispose(); } catch {}
        });
      }
      if (t.searchAddon) try { t.searchAddon.dispose(); } catch (e) {}
      if (t.ws) try { t.ws.close(); } catch (e) {}
      if (t.term) try { t.term.dispose(); } catch (e) {}
      delete terminalsRef.current[id];
    }
    try {
      await apiFetch(`/api/sessions/${id}`, { method: 'DELETE' });
    } catch (err) {
      addToast(`Failed to close session: ${err.message}`, 'error');
    }
    setSessions(prev => {
      const next = prev.filter(s => s.id !== id);
      // Use functional update pattern to avoid stale activeId
      setActiveId(currentActive => {
        if (currentActive === id) {
          return next.length > 0 ? next[next.length - 1].id : null;
        }
        return currentActive;
      });
      return next;
    });
  }, [addToast]);

  // Reconnect session
  const reconnectSession = useCallback((id) => {
    setActiveId(id);
    if (!terminalsRef.current[id]) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => attachTerminal(id));
      });
    }
  }, [attachTerminal]);

  // Reorder session (move session from one index to another)
  const reorderSession = useCallback((fromId, toId) => {
    if (fromId === toId) return;
    setSessions(prev => {
      const fromIdx = prev.findIndex(s => s.id === fromId);
      const toIdx = prev.findIndex(s => s.id === toId);
      if (fromIdx === -1 || toIdx === -1) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
  }, []);

  // Rename session
  const renameSession = useCallback(async (id, newName) => {
    try {
      await apiFetch(`/api/sessions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName }),
      });
      setSessions(prev => prev.map(s => s.id === id ? { ...s, name: newName } : s));
    } catch (err) {
      addToast(`Failed to rename: ${err.message}`, 'error');
    }
  }, [addToast]);

  // Insert file path into active terminal
  const insertPath = useCallback((filePath) => {
    setShowFilePicker(false);
    if (!activeId || !terminalsRef.current[activeId]) return;
    const { ws, term } = terminalsRef.current[activeId];
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'input', data: filePath }));
      setTimeout(() => { if (term) term.focus(); }, 50);
    }
  }, [activeId]);

  // Drag-and-drop file from Finder
  const handleDragOver = useCallback((e) => { e.preventDefault(); e.stopPropagation(); }, []);
  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    const uriList = e.dataTransfer.getData('text/uri-list');
    if (uriList) {
      const paths = uriList.split('\n')
        .map(u => u.trim())
        .filter(u => u.startsWith('file://'))
        .map(u => decodeURIComponent(new URL(u).pathname));
      if (paths.length > 0) {
        insertPath(paths.join(' '));
        return;
      }
    }
  }, [insertPath]);

  // Tab bar scroll indicator
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  useEffect(() => {
    const el = tabBarRef.current;
    if (!el) return;
    const checkScroll = () => {
      setCanScrollLeft(el.scrollLeft > 0);
      setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 1);
    };
    checkScroll();
    el.addEventListener('scroll', checkScroll);
    const ro = new ResizeObserver(checkScroll);
    ro.observe(el);
    return () => { el.removeEventListener('scroll', checkScroll); ro.disconnect(); };
  }, [sessions.length]);

  // Filtered sessions for sidebar
  const filteredSessions = useMemo(() => {
    if (!searchQuery.trim()) return sessions;
    const q = searchQuery.toLowerCase();
    return sessions.filter(s =>
      s.name.toLowerCase().includes(q) || (s.cwd || '').toLowerCase().includes(q)
    );
  }, [sessions, searchQuery]);

  // Stats
  const stats = useMemo(() => {
    const active = sessions.filter(s => s.status === 'active').length;
    const waiting = sessions.filter(s => s.status === 'idle' || s.status === 'waiting').length;
    return { active, waiting, total: sessions.length };
  }, [sessions]);

  // Context menu handler
  const handleContextMenu = useCallback((e, sessionId) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, sessionId });
  }, []);

  if (loading) {
    return html`<div class="app-container"><div class="loading-state"><div class="loading-spinner" /></div></div>`;
  }

  return html`
    <div class="app-container">
      <div class="top-bar">
        <span class=${'top-bar-title' + (sidebarOpen ? '' : ' collapsed')}
          style=${{ width: sidebarOpen ? sidebarWidth + 'px' : '0' }}>Claude Hub</span>
        <${TabBar}
          sessions=${sessions}
          activeId=${activeId}
          onSelect=${reconnectSession}
          onClose=${closeSession}
          onNew=${() => setShowDialog(true)}
          onRename=${renameSession}
          onReorder=${reorderSession}
          onContextMenu=${handleContextMenu}
          tabBarRef=${tabBarRef}
          canScrollLeft=${canScrollLeft}
          canScrollRight=${canScrollRight}
        />
      </div>
      <div class="main-area">
        <${Sidebar}
          sessions=${filteredSessions}
          activeId=${activeId}
          open=${sidebarOpen}
          width=${sidebarWidth}
          onToggle=${() => setSidebarOpen(!sidebarOpen)}
          onResize=${setSidebarWidth}
          onSelect=${reconnectSession}
          onClose=${closeSession}
          onReorder=${reorderSession}
          searchQuery=${searchQuery}
          onSearchChange=${setSearchQuery}
          stats=${stats}
          onContextMenu=${handleContextMenu}
          themePref=${themePref}
          onThemeChange=${setTheme}
        />
        <div class="terminal-area" onDragOver=${handleDragOver} onDrop=${handleDrop}>
          ${sessions.length === 0 ? html`
            <div class="empty-state">
              <div class="empty-state-icon">\u2756</div>
              <div class="empty-state-text">No sessions yet</div>
              <div class="empty-state-hint">Press ${modKey}+T to create a new Claude session</div>
              <button class="btn btn-primary" onClick=${() => setShowDialog(true)}>New Session</button>
            </div>
          ` : sessions.map(s => html`
            <div
              key=${s.id}
              id=${'term-' + s.id}
              class=${'terminal-container' + (s.id !== activeId ? ' hidden' : '')}
            />
          `)}
          ${activeId && sessions.length > 0 && termSearchOpen && terminalsRef.current[activeId] && html`
            <${TermSearchBar}
              entry=${terminalsRef.current[activeId]}
              onClose=${() => { setTermSearchOpen(false); const e = terminalsRef.current[activeId]; if (e && e.searchAddon) try { e.searchAddon.clearDecorations(); } catch {} if (e && e.term) e.term.focus(); }}
              addToast=${addToast}
            />
          `}
          ${activeId && sessions.length > 0 && showScrollBtn && html`
            <button
              class="scroll-bottom-btn"
              onClick=${scrollToBottom}
              title="Scroll to bottom"
            ><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2.5v9M4 8.5l4 4.5 4-4.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
          `}
          ${activeId && sessions.length > 0 && html`
            <button
              class="file-attach-btn"
              onClick=${() => setShowFilePicker(v => !v)}
              title="Attach file"
            >+</button>
            ${showFilePicker && html`
              <${FilePicker}
                sessionCwd=${sessions.find(s => s.id === activeId)?.cwd}
                onPick=${insertPath}
                onClose=${() => setShowFilePicker(false)}
              />
            `}
          `}
        </div>
      </div>

      ${showDialog && html`
        <${NewSessionDialog}
          recentDirs=${recentDirs}
          onCreate=${createSession}
          onCancel=${() => setShowDialog(false)}
        />
      `}

      ${contextMenu && html`
        <${ContextMenu}
          x=${contextMenu.x}
          y=${contextMenu.y}
          sessionId=${contextMenu.sessionId}
          onClose=${() => setContextMenu(null)}
          onRename=${(id) => { setContextMenu(null); startTabRename(id); }}
          onCloseSession=${(id) => { setContextMenu(null); closeSession(id); }}
          sessions=${sessions}
        />
      `}

      <${ToastContainer} toasts=${toasts} onDismiss=${removeToast} />

      <div class="keyboard-hint">
        ${modKey}T new \u00b7 ${modKey}W close \u00b7 ${modKey}1-9 switch \u00b7 ${modKey}\u21e7[ ] prev/next
      </div>
    </div>
  `;
}

// ===== TabBar =====
function TabBar({ sessions, activeId, onSelect, onClose, onNew, onRename, onReorder, onContextMenu, tabBarRef, canScrollLeft, canScrollRight }) {
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');
  const [dragOverId, setDragOverId] = useState(null);
  const dragIdRef = useRef(null);

  // Expose rename trigger via window for context menu
  useEffect(() => {
    window.__startTabRename = (id) => {
      const s = sessions.find(ss => ss.id === id);
      if (s) { setRenamingId(id); setRenameValue(s.name); }
    };
  }, [sessions]);

  const commitRename = () => {
    if (renamingId && renameValue.trim()) onRename(renamingId, renameValue.trim());
    setRenamingId(null);
  };

  const onDragStart = useCallback((e, id) => {
    dragIdRef.current = id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
    // Make the dragged tab semi-transparent after a frame
    requestAnimationFrame(() => { e.target.classList.add('tab-dragging'); });
  }, []);

  const onDragOver = useCallback((e, id) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverId(id);
  }, []);

  const onDrop = useCallback((e, toId) => {
    e.preventDefault();
    const fromId = dragIdRef.current;
    if (fromId && fromId !== toId) onReorder(fromId, toId);
    dragIdRef.current = null;
    setDragOverId(null);
  }, [onReorder]);

  const onDragEnd = useCallback((e) => {
    e.target.classList.remove('tab-dragging');
    dragIdRef.current = null;
    setDragOverId(null);
  }, []);

  const wrapperClass = 'tab-bar-wrapper'
    + (canScrollLeft ? ' can-scroll-left' : '')
    + (canScrollRight ? ' can-scroll-right' : '');

  return html`
    <div class=${wrapperClass}>
      <div class="tab-bar" ref=${tabBarRef}>
        ${sessions.map(s => html`
          <div
            key=${s.id}
            class=${'tab' + (s.id === activeId ? ' active' : '') + (dragOverId === s.id && dragIdRef.current !== s.id ? ' tab-drag-over' : '')}
            draggable=${renamingId !== s.id}
            onClick=${() => onSelect(s.id)}
            onDblClick=${() => { setRenamingId(s.id); setRenameValue(s.name); }}
            onContextMenu=${(e) => onContextMenu(e, s.id)}
            onDragStart=${(e) => onDragStart(e, s.id)}
            onDragOver=${(e) => onDragOver(e, s.id)}
            onDrop=${(e) => onDrop(e, s.id)}
            onDragEnd=${onDragEnd}
            onDragLeave=${() => { if (dragOverId === s.id) setDragOverId(null); }}
            title=${s.name + ' \u2014 ' + (s.cwd || '')}
          >
            <div class=${'tab-status ' + (s.status || 'disconnected')} />
            ${renamingId === s.id ? html`
              <input
                class="tab-rename-input"
                value=${renameValue}
                onInput=${e => setRenameValue(e.target.value)}
                onBlur=${commitRename}
                onKeyDown=${e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenamingId(null); }}
                autoFocus
                onClick=${e => e.stopPropagation()}
              />
            ` : html`
              <span class="tab-name">${s.name}</span>
            `}
            ${s.needsPermission && html`<span class="tab-bell" title="Needs permission">\uD83D\uDD14</span>`}
            <div
              class="tab-close"
              onClick=${(e) => { e.stopPropagation(); onClose(s.id); }}
              title="Close session"
            >\u00d7</div>
          </div>
        `)}
      </div>
      <div class="new-tab-btn" onClick=${onNew} title="${modKey}+T">+</div>
    </div>
  `;
}

// ===== Sidebar =====
function Sidebar({ sessions, activeId, open, width, onToggle, onResize, onSelect, onClose, onReorder, searchQuery, onSearchChange, stats, onContextMenu, themePref, onThemeChange }) {
  const [dragOverId, setDragOverId] = useState(null);
  const dragIdRef = useRef(null);

  const handleResizeStart = useCallback((e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    const handle = e.target;
    handle.classList.add('dragging');

    const onMouseMove = (e) => {
      const newWidth = Math.max(180, Math.min(500, startWidth + e.clientX - startX));
      onResize(newWidth);
    };
    const onMouseUp = () => {
      handle.classList.remove('dragging');
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [width, onResize]);

  return html`
    <div class=${'sidebar' + (open ? '' : ' collapsed')} style=${{ width: open ? width + 'px' : '0' }}>
      <div class="sidebar-header">
        <span>Sessions</span>
        <button class="sidebar-toggle-btn" onClick=${onToggle} title="Collapse sidebar">\u25C0</button>
      </div>
      <div class="sidebar-search">
        <input
          placeholder="Search sessions..."
          value=${searchQuery}
          onInput=${e => onSearchChange(e.target.value)}
        />
      </div>
      ${stats.total > 0 && html`
        <div class="sidebar-stats">
          <div class="sidebar-stat">
            <div class="sidebar-stat-dot" style=${{ background: 'var(--green)' }} />
            ${stats.active} active
          </div>
          <div class="sidebar-stat">
            <div class="sidebar-stat-dot" style=${{ background: 'var(--yellow)' }} />
            ${stats.waiting} waiting
          </div>
          <div class="sidebar-stat">
            ${stats.total} total
          </div>
        </div>
      `}
      <div class="sidebar-list">
        ${sessions.map(s => html`
          <div
            key=${s.id}
            class=${'sidebar-item' + (s.id === activeId ? ' active' : '') + (dragOverId === s.id && dragIdRef.current !== s.id ? ' sidebar-drag-over' : '')}
            draggable=${true}
            onClick=${() => onSelect(s.id)}
            onContextMenu=${(e) => onContextMenu(e, s.id)}
            onDragStart=${(e) => { dragIdRef.current = s.id; e.dataTransfer.effectAllowed = 'move'; requestAnimationFrame(() => e.target.classList.add('sidebar-dragging')); }}
            onDragOver=${(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverId(s.id); }}
            onDrop=${(e) => { e.preventDefault(); if (dragIdRef.current && dragIdRef.current !== s.id) onReorder(dragIdRef.current, s.id); dragIdRef.current = null; setDragOverId(null); }}
            onDragEnd=${(e) => { e.target.classList.remove('sidebar-dragging'); dragIdRef.current = null; setDragOverId(null); }}
            onDragLeave=${() => { if (dragOverId === s.id) setDragOverId(null); }}
            title=${s.cwd || ''}
          >
            <div class=${'tab-status ' + (s.status || 'disconnected')} />
            <div class="sidebar-item-info">
              <div class="sidebar-item-name">${s.name}${s.needsPermission ? html` <span class="tab-bell" title="Needs permission">\uD83D\uDD14</span>` : ''}</div>
              <div class="sidebar-item-meta">
                <span class="sidebar-item-path">${(s.cwd || '').replace(/^\/Users\/\w+/, '~')}</span>
                <span class="sidebar-item-time">${timeAgo(s.lastActiveAt)}</span>
              </div>
            </div>
            <button class="sidebar-item-close" onClick=${(e) => { e.stopPropagation(); onClose(s.id); }} title="Close session">\u00d7</button>
          </div>
        `)}
        ${sessions.length === 0 && html`
          <div style=${{ padding: '16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
            No sessions found
          </div>
        `}
      </div>
      ${open && html`<${ThemeSwitcher} themePref=${themePref} onChange=${onThemeChange} />`}
      ${open && html`<div class="sidebar-resize-handle" onMouseDown=${handleResizeStart} />`}
    </div>
    ${!open && html`
      <button class="sidebar-toggle-btn sidebar-collapsed-toggle" onClick=${onToggle} title="Expand sidebar">\u25B6</button>
    `}
  `;
}

// ===== Context Menu =====
function ContextMenu({ x, y, sessionId, onClose, onCloseSession, sessions }) {
  const session = sessions.find(s => s.id === sessionId);
  if (!session) return null;

  // Adjust position to stay in viewport
  const adjustedX = Math.min(x, window.innerWidth - 180);
  const adjustedY = Math.min(y, window.innerHeight - 120);

  return html`
    <div class="context-menu" style=${{ left: adjustedX + 'px', top: adjustedY + 'px' }}>
      <div class="context-menu-item" onClick=${() => { onClose(); window.__startTabRename?.(sessionId); }}>
        \u270E\u00a0 Rename
      </div>
      <div class="context-menu-divider" />
      <div class="context-menu-item danger" onClick=${() => onCloseSession(sessionId)}>
        \u2715\u00a0 Close Session
      </div>
    </div>
  `;
}

// ===== Folder Browser =====
function FolderBrowser({ value, onChange, recentDirs }) {
  const [browsing, setBrowsing] = useState(false);
  const [folders, setFolders] = useState([]);
  const [currentDir, setCurrentDir] = useState('');
  const [parentDir, setParentDir] = useState(null);
  const [loading, setLoading] = useState(false);

  const browse = useCallback(async (dir) => {
    setLoading(true);
    try {
      const data = await apiFetch(`/api/browse?path=${encodeURIComponent(dir || '~')}`);
      // Normalize: backend returns {name, mtime} objects
      setFolders((data.folders || []).map(f => typeof f === 'string' ? f : f.name));
      setCurrentDir(data.current);
      setParentDir(data.parent);
      setBrowsing(true);
    } catch (e) {
      // fallback
    }
    setLoading(false);
  }, []);

  const openBrowser = () => browse(value || '~');

  const selectFolder = (name) => {
    const newPath = currentDir + '/' + name;
    onChange(newPath);
    browse(newPath);
  };

  const goUp = () => {
    if (parentDir) {
      onChange(parentDir);
      browse(parentDir);
    }
  };

  const pickCurrent = () => {
    onChange(currentDir);
    setBrowsing(false);
  };

  return html`
    <div class="folder-browser">
      <div class="folder-input-row">
        <input
          value=${value}
          onInput=${e => onChange(e.target.value)}
          placeholder="/path/to/project"
          class="folder-input"
        />
        <button class="btn btn-secondary folder-browse-btn" onClick=${openBrowser} type="button">
          Browse
        </button>
      </div>

      ${!browsing && recentDirs.length > 0 && html`
        <div class="dir-suggestions">
          ${recentDirs.slice(0, 6).map(d => html`
            <span key=${d} class="dir-chip" onClick=${() => { onChange(d); }} tabIndex="0"
              onKeyDown=${e => { if (e.key === 'Enter') onChange(d); }}>
              ${d.replace(/^\/Users\/\w+/, '~')}
            </span>
          `)}
        </div>
      `}

      ${browsing && html`
        <div class="folder-list-container">
          <div class="folder-list-header">
            <span class="folder-list-path" title=${currentDir}>
              ${currentDir.replace(/^\/Users\/\w+/, '~')}
            </span>
            <button class="btn-icon" onClick=${pickCurrent} title="Select this folder">\u2713</button>
            <button class="btn-icon" onClick=${() => setBrowsing(false)} title="Close">\u2715</button>
          </div>
          <div class="folder-list">
            ${parentDir && html`
              <div class="folder-item folder-item-parent" onClick=${goUp}>
                \u2190\u00a0\u00a0..
              </div>
            `}
            ${loading ? html`
              <div class="folder-item" style=${{ color: 'var(--text-muted)', cursor: 'default' }}>Loading...</div>
            ` : folders.length === 0 ? html`
              <div class="folder-item" style=${{ color: 'var(--text-muted)', cursor: 'default' }}>No subfolders</div>
            ` : folders.map(f => html`
              <div key=${f} class="folder-item" onClick=${() => selectFolder(f)}>
                \uD83D\uDCC1\u00a0\u00a0${f}
              </div>
            `)}
          </div>
        </div>
      `}
    </div>
  `;
}

// ===== New Session Dialog =====
// ===== File Picker =====
function FilePicker({ sessionCwd, onPick, onClose }) {
  const [currentDir, setCurrentDir] = useState(sessionCwd || '~');
  const [parentDir, setParentDir] = useState(null);
  const [folders, setFolders] = useState([]);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');
  const filterRef = useRef(null);
  const ref = useRef(null);

  const browse = useCallback(async (dir) => {
    setLoading(true);
    setFilter('');
    try {
      const data = await apiFetch(`/api/browse?path=${encodeURIComponent(dir)}&files=1`);
      setCurrentDir(data.current);
      setParentDir(data.parent);
      // Normalize: backend now returns {name, mtime} objects, already sorted by mtime desc
      setFolders(data.folders || []);
      setFiles(data.files || []);
    } catch (e) {}
    setLoading(false);
  }, []);

  useEffect(() => { browse(sessionCwd || '~'); }, []);

  const filteredFolders = useMemo(() => {
    const list = folders.map(f => typeof f === 'string' ? { name: f, mtime: 0 } : f);
    if (!filter.trim()) return list;
    const q = filter.toLowerCase();
    return list.filter(f => f.name.toLowerCase().includes(q));
  }, [folders, filter]);

  // Group files by category, each category sorted by mtime desc (already from backend)
  const FILE_CATEGORIES = [
    { label: 'Documents', exts: ['md','txt','pdf','doc','docx','rtf','csv','json','yaml','yml','toml','xml'] },
    { label: 'Code', exts: ['js','ts','jsx','tsx','py','sh','rb','go','rs','java','c','cpp','h','swift','kt','css','html','sql'] },
    { label: 'Media', exts: ['png','jpg','jpeg','gif','svg','webp','ico','mp4','mov','mp3','wav','m4a'] },
  ];

  const groupedFiles = useMemo(() => {
    let list = files.map(f => typeof f === 'string' ? { name: f, mtime: 0 } : f);
    if (filter.trim()) {
      const q = filter.toLowerCase();
      list = list.filter(f => f.name.toLowerCase().includes(q));
    }
    const groups = [];
    const used = new Set();
    for (const cat of FILE_CATEGORIES) {
      const items = list.filter(f => {
        const ext = f.name.split('.').pop().toLowerCase();
        return cat.exts.includes(ext);
      });
      if (items.length > 0) {
        groups.push({ label: cat.label, items });
        items.forEach(f => used.add(f.name));
      }
    }
    const other = list.filter(f => !used.has(f.name));
    if (other.length > 0) groups.push({ label: 'Other', items: other });
    return groups;
  }, [files, filter]);

  // Close on outside click
  useEffect(() => {
    const handleClick = (e) => {
      if (ref.current && !ref.current.contains(e.target) && !e.target.closest('.file-attach-btn')) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  const getFileIcon = (name) => {
    const ext = name.split('.').pop().toLowerCase();
    if (['png','jpg','jpeg','gif','svg','webp','ico'].includes(ext)) return '\u{1F5BC}';
    if (['pdf'].includes(ext)) return '\u{1F4C4}';
    if (['md','txt','json','yaml','yml','toml','csv'].includes(ext)) return '\u{1F4DD}';
    if (['js','ts','py','sh','rb','go','rs','java','c','cpp','h'].includes(ext)) return '\u{1F4BB}';
    return '\u{1F4CE}';
  };

  return html`
    <div class="file-picker" ref=${ref}>
      <div class="file-picker-header">
        <span class="file-picker-path" title=${currentDir}>
          ${currentDir.replace(/^\/Users\/\w+/, '~')}
        </span>
        <button class="btn-icon" onClick=${onClose} title="Close">\u2715</button>
      </div>
      <div class="file-picker-filter">
        <input
          ref=${filterRef}
          value=${filter}
          onInput=${e => setFilter(e.target.value)}
          placeholder="Search files by name..."
          autoFocus
        />
      </div>
      <div class="file-picker-list">
        ${parentDir && !filter.trim() && html`
          <div class="file-picker-item folder" onClick=${() => browse(parentDir)}>
            \u2190\u00a0\u00a0..
          </div>
        `}
        ${loading && html`<div class="file-picker-empty">Loading...</div>`}
        ${!loading && filteredFolders.length > 0 && html`
          <div class="file-picker-group-label">Folders</div>
        `}
        ${!loading && filteredFolders.map(f => html`
          <div key=${'d-'+f.name} class="file-picker-item folder"
            onClick=${() => browse(currentDir + '/' + f.name)}>
            \u{1F4C1}\u00a0\u00a0${f.name}
          </div>
        `)}
        ${!loading && groupedFiles.map(g => html`
          <div key=${g.label}>
            <div class="file-picker-group-label">${g.label}</div>
            ${g.items.map(f => html`
              <div key=${'f-'+f.name} class="file-picker-item file"
                onClick=${() => onPick(currentDir + '/' + f.name)}>
                ${getFileIcon(f.name)}\u00a0\u00a0${f.name}
              </div>
            `)}
          </div>
        `)}
        ${!loading && filteredFolders.length === 0 && groupedFiles.length === 0 && html`
          <div class="file-picker-empty">${filter.trim() ? 'No matches' : 'Empty folder'}</div>
        `}
      </div>
    </div>
  `;
}

function NewSessionDialog({ recentDirs, onCreate, onCancel }) {
  const [name, setName] = useState('');
  const DEFAULT_CWD = '/Users/janet/Desktop/各种文档/Janet知识库';
  const [cwd, setCwd] = useState(DEFAULT_CWD);
  const [model, setModel] = useState('claude-opus-4-7[1m]');
  const [resumeFlag, setResumeFlag] = useState(false);
  const [permissionMode, setPermissionMode] = useState('bypassPermissions');
  const dialogRef = useRef(null);

  // Sync cwd with recentDirs when they load async
  useEffect(() => {
    if (!cwd) setCwd(DEFAULT_CWD);
  }, [recentDirs]);

  const handleCreate = () => {
    const args = [];
    if (model) args.push('--model', model);
    if (resumeFlag) args.push('--resume');
    if (permissionMode) args.push('--permission-mode', permissionMode);
    const finalCwd = cwd.trim() || recentDirs[0] || '';
    const finalName = name.trim() || 'Session ' + (Date.now() % 1000);
    onCreate(finalName, finalCwd, args);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') onCancel();
  };

  const handleFormKeyDown = (e) => {
    if (e.key === 'Enter' && e.target.tagName !== 'SELECT' && !e.target.closest('.folder-browser')) {
      e.preventDefault();
      handleCreate();
    }
  };

  return html`
    <div class="dialog-overlay" onClick=${onCancel} onKeyDown=${handleKeyDown}>
      <div class="dialog" ref=${dialogRef} onClick=${e => e.stopPropagation()} onKeyDown=${handleFormKeyDown}>
        <div class="dialog-title">New Claude Session</div>

        <div class="dialog-field">
          <label>Session Name</label>
          <input
            value=${name}
            onInput=${e => setName(e.target.value)}
            placeholder="e.g. claude-hub dev"
            autoFocus
          />
        </div>

        <div class="dialog-field">
          <label>Working Directory</label>
          <${FolderBrowser} value=${cwd} onChange=${setCwd} recentDirs=${recentDirs} />
        </div>

        <div class="dialog-row">
          <div class="dialog-field">
            <label>Model</label>
            <${CustomSelect}
              value=${model}
              onChange=${setModel}
              options=${[
                { value: '', label: 'Default' },
                { value: 'claude-opus-4-7[1m]', label: 'Opus 4.7 (1M)' },
                { value: 'claude-opus-4-7', label: 'Opus 4.7 (200K)' },
                { value: 'claude-opus-4-6[1m]', label: 'Opus 4.6 (1M)' },
                { value: 'claude-opus-4-6', label: 'Opus 4.6 (200K)' },
                { value: 'claude-sonnet-4-6[1m]', label: 'Sonnet 4.6 (1M)' },
                { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6 (200K)' },
              ]}
            />
          </div>
          <div class="dialog-field">
            <label>Permission Mode</label>
            <${CustomSelect}
              value=${permissionMode}
              onChange=${setPermissionMode}
              options=${[
                { value: '', label: 'Default' },
                { value: 'plan', label: 'Plan' },
                { value: 'bypassPermissions', label: 'Bypass' },
              ]}
            />
          </div>
        </div>

        <div class="dialog-field">
          <label class="dialog-checkbox">
            <input
              type="checkbox"
              checked=${resumeFlag}
              onChange=${e => setResumeFlag(e.target.checked)}
            />
            Resume last conversation
          </label>
          <div class="dialog-checkbox-hint">Continue where Claude left off (--resume)</div>
        </div>

        <div class="dialog-actions">
          <button class="btn btn-secondary" onClick=${onCancel}>Cancel</button>
          <button class="btn btn-primary" onClick=${handleCreate}>Create Session</button>
        </div>
      </div>
    </div>
  `;
}

// ===== Terminal Search Bar (⌘F) =====
function TermSearchBar({ entry, onClose, addToast }) {
  const [query, setQuery] = useState('');
  const [count, setCount] = useState({ resultIndex: -1, resultCount: 0 });
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current && inputRef.current.focus();
  }, []);

  // SearchAddon 提供 onDidChangeResults 事件
  useEffect(() => {
    if (!entry || !entry.searchAddon || !entry.searchAddon.onDidChangeResults) return;
    const dispose = entry.searchAddon.onDidChangeResults(e => {
      setCount({ resultIndex: e.resultIndex, resultCount: e.resultCount });
    });
    return () => { try { dispose && dispose.dispose && dispose.dispose(); } catch {} };
  }, [entry]);

  const search = useCallback((dir) => {
    if (!entry || !entry.searchAddon || !query) return;
    const opts = { decorations: {
      matchBackground: '#FFB347',
      matchOverviewRuler: '#FFB347',
      activeMatchBackground: '#FF7F50',
      activeMatchColorOverviewRuler: '#FF7F50',
    }};
    try {
      if (dir > 0) entry.searchAddon.findNext(query, opts);
      else entry.searchAddon.findPrevious(query, opts);
    } catch (e) {
      addToast && addToast('Search not available in this terminal', 'info', 2000);
    }
  }, [entry, query, addToast]);

  const onKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); search(e.shiftKey ? -1 : 1); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };

  const countText = count.resultCount > 0
    ? `${count.resultIndex + 1}/${count.resultCount}`
    : (query ? '0' : '');

  return html`
    <div class="term-search">
      <input
        ref=${inputRef}
        value=${query}
        placeholder="Search..."
        onInput=${e => setQuery(e.target.value)}
        onKeyDown=${onKeyDown}
      />
      <span class="term-search-count">${countText}</span>
      <button class="term-search-btn" title="Previous (⇧⏎)" onClick=${() => search(-1)} disabled=${!query}>↑</button>
      <button class="term-search-btn" title="Next (⏎)" onClick=${() => search(1)} disabled=${!query}>↓</button>
      <button class="term-search-btn" title="Close (Esc)" onClick=${onClose}>✕</button>
    </div>
  `;
}

// ===== Theme Switcher (sidebar 底部小圆点) =====
function ThemeSwitcher({ themePref, onChange }) {
  const options = [
    { name: 'auto', label: 'Auto' },
    { name: 'warm-beige', label: 'Warm Beige' },
    { name: 'paper-white', label: 'Paper White' },
    { name: 'dark-mocha', label: 'Dark Mocha' },
    { name: 'midnight', label: 'Midnight' },
  ];
  return html`
    <div class="theme-switcher">
      <span class="theme-switcher-label">Theme</span>
      <div class="theme-switcher-dots">
        ${options.map(o => html`
          <button
            key=${o.name}
            class=${'theme-switcher-dot' + (themePref === o.name ? ' active' : '')}
            data-name=${o.name}
            title=${o.label}
            onClick=${() => onChange(o.name)}
          />
        `)}
      </div>
    </div>
  `;
}

// ===== Toast Container =====
function ToastContainer({ toasts, onDismiss }) {
  const icons = { info: '\u2139\uFE0F', success: '\u2705', error: '\u274C', attention: '\u26A0\uFE0F' };
  return html`
    <div class="toast-container">
      ${toasts.map(t => html`
        <div key=${t.id} class=${'toast ' + t.type} onClick=${() => onDismiss(t.id)}>
          <span class="toast-icon">${icons[t.type] || ''}</span>
          <span class="toast-text">${t.text}</span>
        </div>
      `)}
    </div>
  `;
}

// Expose rename function globally for context menu
function startTabRename(id) {
  window.__startTabRename?.(id);
}

// ===== Mount =====
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(React.createElement(App));
