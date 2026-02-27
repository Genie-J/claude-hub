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

// ===== Terminal Theme =====
const termTheme = {
  background: '#f0ede6',
  foreground: '#3b3833',
  cursor: '#5c574f',
  cursorAccent: '#f0ede6',
  selectionBackground: '#cdc7ba',
  selectionForeground: '#3b3833',
  black: '#3b3833',
  red: '#c25d4e',
  green: '#6b8f71',
  yellow: '#c49a2a',
  blue: '#5a7a9e',
  magenta: '#8b6d9e',
  cyan: '#5a8f8f',
  white: '#e8e4dc',
  brightBlack: '#8a847a',
  brightRed: '#d4685a',
  brightGreen: '#7da383',
  brightYellow: '#d4a93a',
  brightBlue: '#6a8ab0',
  brightMagenta: '#9d7fb0',
  brightCyan: '#6aa0a0',
  brightWhite: '#f0ede6',
};

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
  const { toasts, addToast, removeToast } = useToasts();
  const terminalsRef = useRef({});
  const tabBarRef = useRef(null);
  const prevStatusRef = useRef({});

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
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeId]);

  // Close context menu on click anywhere
  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, [contextMenu]);

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
        if (t.fitAddon) try { t.fitAddon.fit(); } catch (e) {}
      });
    }, 100);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

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
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 16,
      fontFamily: "'SF Mono', 'Menlo', 'Monaco', 'Courier New', monospace",
      theme: termTheme,
      allowTransparency: false,
      scrollback: 10000,
      convertEol: true,
    });

    const fitAddon = new FitAddon.FitAddon();
    const webLinksAddon = new WebLinksAddon.WebLinksAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);

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
          s.id === msg.sessionId ? { ...s, status: msg.status } : s
        ));
      } else if (msg.type === 'error') {
        addToast(msg.message, 'error');
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

    terminalsRef.current[sessionId] = { term, ws, fitAddon, resizeObserver: null };

    term.open(container);

    // Use ResizeObserver for reliable fitting
    const debouncedFit = debounce(() => {
      try { fitAddon.fit(); } catch (e) {}
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
          searchQuery=${searchQuery}
          onSearchChange=${setSearchQuery}
          stats=${stats}
          onContextMenu=${handleContextMenu}
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
function TabBar({ sessions, activeId, onSelect, onClose, onNew, onRename, onContextMenu, tabBarRef, canScrollLeft, canScrollRight }) {
  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState('');

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

  const wrapperClass = 'tab-bar-wrapper'
    + (canScrollLeft ? ' can-scroll-left' : '')
    + (canScrollRight ? ' can-scroll-right' : '');

  return html`
    <div class=${wrapperClass}>
      <div class="tab-bar" ref=${tabBarRef}>
        ${sessions.map(s => html`
          <div
            key=${s.id}
            class=${'tab' + (s.id === activeId ? ' active' : '')}
            onClick=${() => onSelect(s.id)}
            onDblClick=${() => { setRenamingId(s.id); setRenameValue(s.name); }}
            onContextMenu=${(e) => onContextMenu(e, s.id)}
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
function Sidebar({ sessions, activeId, open, width, onToggle, onResize, onSelect, onClose, searchQuery, onSearchChange, stats, onContextMenu }) {
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
            class=${'sidebar-item' + (s.id === activeId ? ' active' : '')}
            onClick=${() => onSelect(s.id)}
            onContextMenu=${(e) => onContextMenu(e, s.id)}
            title=${s.cwd || ''}
          >
            <div class=${'tab-status ' + (s.status || 'disconnected')} />
            <div class="sidebar-item-info">
              <div class="sidebar-item-name">${s.name}</div>
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
      setFolders(data.folders);
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
  const ref = useRef(null);

  const browse = useCallback(async (dir) => {
    setLoading(true);
    try {
      const data = await apiFetch(`/api/browse?path=${encodeURIComponent(dir)}&files=1`);
      setCurrentDir(data.current);
      setParentDir(data.parent);
      setFolders(data.folders);
      setFiles(data.files || []);
    } catch (e) {}
    setLoading(false);
  }, []);

  useEffect(() => { browse(sessionCwd || '~'); }, []);

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
      <div class="file-picker-list">
        ${parentDir && html`
          <div class="file-picker-item folder" onClick=${() => browse(parentDir)}>
            \u2190\u00a0\u00a0..
          </div>
        `}
        ${loading && html`<div class="file-picker-empty">Loading...</div>`}
        ${!loading && folders.map(f => html`
          <div key=${'d-'+f} class="file-picker-item folder"
            onClick=${() => browse(currentDir + '/' + f)}>
            \u{1F4C1}\u00a0\u00a0${f}
          </div>
        `)}
        ${!loading && files.map(f => html`
          <div key=${'f-'+f} class="file-picker-item file"
            onClick=${() => onPick(currentDir + '/' + f)}>
            ${getFileIcon(f)}\u00a0\u00a0${f}
          </div>
        `)}
        ${!loading && folders.length === 0 && files.length === 0 && html`
          <div class="file-picker-empty">Empty folder</div>
        `}
      </div>
    </div>
  `;
}

function NewSessionDialog({ recentDirs, onCreate, onCancel }) {
  const [name, setName] = useState('');
  const DEFAULT_CWD = '/Users/janet/Desktop/各种文档/Janet知识库';
  const [cwd, setCwd] = useState(DEFAULT_CWD);
  const [model, setModel] = useState('');
  const [resumeFlag, setResumeFlag] = useState(false);
  const [permissionMode, setPermissionMode] = useState('');
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
                { value: 'claude-opus-4-6', label: 'Opus 4.6' },
                { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
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
