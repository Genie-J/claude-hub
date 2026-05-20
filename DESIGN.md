# Design System: Claude Hub

## 1. Visual Theme & Atmosphere

A warm, paper-toned interface that feels like a well-worn notebook rather than a sterile IDE. The primary background (`#f0ede6`) reads as aged parchment — deliberately rejecting the cold whites and dark blacks of typical developer tools. This warmth is the foundation of the entire visual identity, carried through to the terminal emulator, dialogs, and every surface.

Typography relies entirely on the system font stack (SF Pro / system-ui) with precise weight differentiation: bold for navigation anchors, medium for interactive elements, regular for content. No custom fonts, no loading latency — the system font at the right weight carries all the semantic load.

The accent color is a muted sage green (`#6b8f71`) — calming rather than demanding attention. It appears only for primary actions, active states, and focus rings. Status colors (green, yellow, red) follow the traffic-light convention but are desaturated to match the warm palette. The overall impression is "a tool that's been with you for years, not one that shipped yesterday."

**Key Characteristics:**
- Warm parchment background (`#f0ede6`) — never cold white or true black
- Muted sage green accent (`#6b8f71`) — calm and purposeful, not loud
- Three-tier warm gray surfaces (`#f0ede6` → `#e8e4dc` → `#dfd9ce`) for depth without shadows
- System font stack with 4-tier weight hierarchy (400/500/600/700)
- Minimal shadow usage — elevation comes primarily from background color stepping
- Custom xterm.js terminal theme matching the warm palette
- Light mode only — no dark theme
- Desktop-first, no responsive breakpoints

## 2. Color Palette & Roles

### Background Surfaces

- **Primary Background** (`#f0ede6`) — The parchment canvas. Used for main content area, terminal background, and the identity color of the app.
- **Secondary Background** (`#e8e4dc`) — One step darker. Used for sidebar, creating visual separation without borders.
- **Tertiary Background** (`#dfd9ce`) — Two steps darker. Used for the top bar, the most grounded surface layer.
- **Surface** (`#e3dfd7`) — Generic elevated surface for buttons, inputs, and interactive affordances.
- **Tab Default** (`#e3dfd7`) — Inactive tab background.
- **Tab Active** (`#f0ede6`) — Active tab matches primary background, creating a "connected" visual.
- **Tab Hover** (`#d8d3c8`) — Subtle darkening on hover.

### Text & Content

- **Primary Text** (`#3b3833`) — Deep warm brown. All body text and headings. Never pure black.
- **Secondary Text** (`#5c574f`) — Muted brown for supporting information, timestamps, paths.
- **Muted Text** (`#8a847a`) — Disabled states, placeholder text, least important labels.

### Brand & Accent

- **Accent** (`#6b8f71`) — Sage green. Primary buttons, active states, focus rings, progress indicators.
- **Accent Hover** (`#5a7d60`) — Darkened on interaction.
- **Accent Light** (`rgba(107,143,113,0.12)`) — Tinted backgrounds for active sidebar items, selected states.

### Status Colors

- **Green** (`#6b8f71`) — Active, success, running sessions.
- **Yellow** (`#c49a2a`) — Warning, waiting, pending input.
- **Red** (`#c25d4e`) — Error, danger, exited sessions, destructive actions.
- **Blue** (`#5a7a9e`) — Terminal ANSI blue (informational).
- **Magenta** (`#8b6d9e`) — Terminal ANSI magenta.
- **Cyan** (`#5a8f8f`) — Terminal ANSI cyan.

### Borders & Dividers

- **Border** (`#cdc7ba`) — Standard borders for panels, inputs, and structural dividers.
- **Border Light** (`#dad5cb`) — Lighter borders for subtle separation within components.

### Shadows

- **Shadow Small** — `0 1px 3px rgba(0,0,0,0.06)` — Buttons, small interactive elements.
- **Shadow Medium** — `0 4px 12px rgba(0,0,0,0.08)` — Elevated cards, hover states.
- **Shadow Large** — `0 12px 40px rgba(0,0,0,0.12)` — Dialogs, overlays, context menus, file picker.

### Toast Notification Backgrounds

- **Info**: `var(--bg-primary)` (neutral parchment)
- **Success**: `#f0f7f1` (soft green tint)
- **Error**: `#fdf4f3` (soft red tint)
- **Attention**: `#fdf8ed` (soft yellow tint)

## 3. Typography Rules

### Font Family

- **Primary**: `'PingFang SC', -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', system-ui, sans-serif` — 中文走 PingFang SC（macOS 系统字体），英文回落 SF Pro
- **Monospace**: xterm.js default (terminal only)
- **Font rendering**: `-webkit-font-smoothing: antialiased`

### Hierarchy

| Role | Size | Weight | Letter Spacing | Use |
|------|------|--------|---------------|-----|
| Top Bar Title | 16px | 700 (Bold) | default | App title, navigation anchors |
| Dialog Title | 16px | 600 (Semibold) | default | Modal headers |
| Body / Tab Label | 15px | 500 (Medium) | default | Tab names, sidebar items, main content |
| Sidebar Section Header | 14px | 600 (Semibold) | 0.8px | Section labels (uppercase) |
| Button / Input | 13px | 500 (Medium) | default | Interactive controls, form fields |
| Sidebar Meta | 13px | 400 (Regular) | default | File paths, timestamps |
| Dialog Label | 12px | 500 (Medium) | default | Form field labels in dialogs |
| Toast / Hint | 12px | 400 (Regular) | default | Notifications, helper text |
| Micro Label | 11px | 400 (Regular) | default | Smallest text elements |

### Principles

- **System font only** — no custom fonts, no loading delay, instant rendering
- **Weight carries meaning** — 700 for fixed navigation, 600 for section headers, 500 for interactive elements, 400 for passive content
- **Uppercase + tracking for section headers** — 0.8px letter-spacing on 14px semibold sidebar headers creates structural hierarchy
- **13px for controls** — buttons and inputs use a deliberately compact size for information density

## 4. Component Stylings

### Buttons

**Primary Button (`.btn-primary`)**
- Background: `#6b8f71` (accent)
- Text: `#ffffff`, 13px, weight 500
- Padding: 8px 18px
- Radius: 8px
- Shadow: small (0 1px 3px rgba(0,0,0,0.06))
- Hover: background darkens to `#5a7d60`, shadow upgrades to medium
- Active: `transform: scale(0.98)`
- Use: Primary CTAs — "Create", "Save", "Connect"

**Secondary Button (`.btn-secondary`)**
- Background: `#e3dfd7` (surface)
- Text: `#3b3833` (primary text)
- Border: 1px solid `#cdc7ba`
- Padding: 8px 18px
- Radius: 8px
- Hover: background darkens to `#cdc7ba`
- Use: Cancel, alternative actions

**Icon Button (`.btn-icon`)**
- Size: 26×26px
- Radius: 4px
- Background: transparent
- Hover: background appears (`var(--surface)`)
- Use: Close, minimize, toolbar actions

### Tabs

**Tab Item**
- Height: 34px
- Min width: 130px, max width: 220px
- Background: `#e3dfd7` (default), `#f0ede6` (active), `#d8d3c8` (hover)
- Radius: 8px 8px 0 0 (top corners only)
- Font: 15px, weight 500
- Gap between icon and label: 8px
- Close button: 20×20px, appears on hover

**Tab Status Indicator**
- Size: 8×8px circle
- Active: `#34a853` with pulse animation (2s)
- Idle: `#a0998f` (gray, no animation)
- Waiting: `#e8a735` with pulse animation (1.5s)
- Exited: `#c0392b` (red)
- Disconnected: `#c0392b` at 50% opacity

### Sidebar

**Container**
- Width: 260px (resizable via drag)
- Background: `#e8e4dc` (secondary)
- Border: 1px solid `#cdc7ba` (right edge)
- Collapsible to 0px width

**Sidebar Item**
- Padding: 10px 12px
- Radius: 8px
- Margin bottom: 2px
- Active state: background `rgba(107,143,113,0.12)`, left border 3px solid `#6b8f71`
- Font: 15px, weight 500

**Section Header**
- Padding: 14px 16px 10px
- Font: 14px, weight 600, uppercase, letter-spacing 0.8px

### Dialogs

**Dialog Container**
- Width: 460px (max 90vw)
- Padding: 28px
- Radius: 12px
- Shadow: large (0 12px 40px rgba(0,0,0,0.12))
- Animation: slideUp 0.2s ease

**Dialog Overlay**
- Background: `rgba(0,0,0,0.2)` + `backdrop-filter: blur(4px)`
- Animation: fadeIn 0.15s ease

### Inputs & Forms

**Standard Input**
- Padding: 9px 12px
- Border: 1px solid `#dad5cb`
- Radius: 8px
- Focus: border `#6b8f71`, box-shadow `0 0 0 3px rgba(107,143,113,0.12)`

**Search Input**
- Padding: 6px 10px (compact)
- Same border and focus treatment

### Toast Notifications

- Padding: 10px 16px
- Radius: 8px
- Font: 12px
- Shadow: large
- Max width: 360px
- Position: fixed bottom-right (20px from edges)
- Animation: toastIn 0.25s ease (translate + scale)

### Context Menu

- Min width: 160px
- Padding: 4px
- Radius: 8px
- Shadow: large
- Item padding: 7px 12px
- Danger items: text color `#c25d4e`
- Animation: fadeIn 0.1s ease

### File Picker

- Width: 320px
- Max height: 380px
- Position: fixed bottom-right (bottom 84px, right 20px)
- Radius: 12px
- Shadow: large
- Animation: slideUp 0.15s ease

### Floating Action Buttons

**Scroll-to-Bottom**
- Size: 36×36px circle
- Background: `rgba(60,110,75,0.65)` + `backdrop-filter: blur(12px)`
- Border: 1px solid `rgba(255,255,255,0.08)`
- Animation: breathe 3s (opacity 0.6–0.95)
- Hover: solid background `rgba(45,80,56,0.95)`, animation pauses

**File Attach**
- Size: 36×36px circle
- Background: `#6b8f71`
- Color: white
- Shadow: medium
- Hover: scale(1.08), shadow upgrades to large

## 5. Layout Principles

### Spacing System

| Token | Value | Use |
|-------|-------|-----|
| xs | 4px | Radius-sm, micro gaps |
| sm | 8px | Radius-md, button padding, standard gaps |
| md | 12px | Radius-lg, sidebar item padding, section padding |
| lg | 16px | Title padding, search bar padding, major spacing |
| xl | 28px | Dialog padding, section margin-top |

### Panel Structure

The layout is a fixed three-panel architecture:
1. **Top Bar** (42px height) — navigation, tabs, session controls
2. **Sidebar** (260px width, left) — session list, file browser
3. **Main Content** (remaining space) — terminal output, conversation

All panels are flex-based, no CSS Grid. Sidebar width is user-resizable via drag handle.

### Whitespace Philosophy

- **Density over breathing room** — this is a productivity tool, not a reading experience. Compact spacing (8–12px) keeps information dense.
- **Surface color replaces whitespace** — depth comes from the three-tier background stepping, not from generous gaps between elements.
- **Borders are structural** — borders exist for panel division, not decoration. Within panels, spacing alone creates hierarchy.

### Border Radius Scale

| Token | Value | Use |
|-------|-------|-----|
| Small | 4px | Icon buttons, inline badges |
| Medium | 8px | Standard buttons, inputs, sidebar items, tabs (top), cards |
| Large | 12px | Dialogs, file picker, floating panels |
| Circle | 50% | Status indicators (8px), floating action buttons (36px) |

## 6. Depth & Elevation

| Level | Treatment | Use |
|-------|-----------|-----|
| Level 0 (Recessed) | Background `#dfd9ce` (tertiary) | Top bar — the "deepest" layer |
| Level 1 (Base) | Background `#e8e4dc` (secondary) | Sidebar — middle layer |
| Level 2 (Surface) | Background `#f0ede6` (primary) | Main content, active tabs — the "paper" layer |
| Level 3 (Elevated) | Shadow-sm, background surface | Buttons, inputs — slightly raised |
| Level 4 (Floating) | Shadow-lg, background primary | Dialogs, context menus, file picker — overlay layer |

**Depth Philosophy:** Claude Hub uses background color stepping as the primary depth mechanism — not shadows. The top bar is darkest (recessed), the sidebar is middle, and the main content area is lightest (closest to the user). Shadows are reserved for true overlays (dialogs, menus) that float above the panel structure. This creates a "layers of paper" effect rather than the "floating cards" paradigm.

## 7. Do's and Don'ts

### Do

- Use the warm parchment background (`#f0ede6`) as the identity color — it extends to the terminal, the manifest theme, everywhere
- Rely on background color stepping for depth — three tiers (`#dfd9ce` → `#e8e4dc` → `#f0ede6`) from back to front
- Keep the accent green (`#6b8f71`) for interactive states only — it should always mean "this is actionable"
- Use 3px focus ring in accent-light (`rgba(107,143,113,0.12)`) for keyboard navigation — consistent across all inputs
- Keep button text at 13px medium — compact and professional
- Use slideUp animation (0.15–0.2s ease) for all appearing panels — consistent entry motion
- Match the xterm.js theme to the UI palette — terminal should feel like part of the app, not an embedded foreign widget
- Use backdrop-filter blur on overlays — the dialog overlay at `blur(4px)` creates gentle depth without harsh darkening

### Don't

- Don't use pure white (`#ffffff`) or pure black (`#000000`) for backgrounds — always use the warm palette
- Don't introduce new accent colors beyond the sage green — the monochrome-plus-one-accent constraint is deliberate
- Don't use large shadows for non-overlay elements — shadows are reserved for Level 4 (floating) only
- Don't add responsive breakpoints — this is a desktop-only tool
- Don't use custom fonts — the system font stack at precise weights is the typography system
- Don't use bright saturated status colors — all status colors are desaturated to match the warm palette (green `#6b8f71`, not `#00ff00`)
- Don't animate with bounce or overshoot — all animations are subtle ease transitions (0.1–0.25s)
- Don't add dark mode — the warm parchment identity doesn't translate to dark surfaces

## 8. Responsive Behavior

### Device Support

| Device | Support | Notes |
|--------|---------|-------|
| Desktop (1024px+) | Primary target | Three-panel layout, resizable sidebar |
| Tablet | Not targeted | — |
| Mobile | Not targeted | — |

### Adaptive Elements

- **Sidebar**: Resizable via drag handle, collapsible to 0px width. No responsive breakpoint — user manually controls visibility.
- **Dialog**: Max-width 90vw prevents overflow on narrow monitors, but no layout changes.
- **Tab Bar**: Horizontal scroll with fade gradients (24px) at edges when overflow occurs.
- **Scrollbars**: Hidden system scrollbars throughout (`scrollbar-width: none`). Smooth scroll behavior.

### Touch Targets

- Floating action buttons: 36×36px (adequate for accidental mouse use, not touch-optimized)
- Icon buttons: 26×26px (mouse-optimized, below touch minimum)
- Sidebar items: 10px vertical padding on full-width elements (adequate)

## 9. Agent Prompt Guide

### Quick Color Reference

- Page background: Warm Parchment (`#f0ede6`)
- Sidebar background: Secondary (`#e8e4dc`)
- Top bar background: Tertiary (`#dfd9ce`)
- Surface / inactive elements: (`#e3dfd7`)
- Primary text: Deep Brown (`#3b3833`)
- Secondary text: Muted Brown (`#5c574f`)
- Disabled text: Warm Gray (`#8a847a`)
- Accent / interactive: Sage Green (`#6b8f71`)
- Accent hover: Dark Sage (`#5a7d60`)
- Accent light: Sage at 12% (`rgba(107,143,113,0.12)`)
- Border: Warm Tan (`#cdc7ba`)
- Light border: Pale Tan (`#dad5cb`)
- Error / danger: Dusty Red (`#c25d4e`)
- Warning: Warm Amber (`#c49a2a`)
- Success: Sage Green (`#6b8f71`)

### CSS Variable Quick Reference

```css
:root {
  --bg-primary: #f0ede6;
  --bg-secondary: #e8e4dc;
  --bg-tertiary: #dfd9ce;
  --surface: #e3dfd7;
  --text-primary: #3b3833;
  --text-secondary: #5c574f;
  --text-muted: #8a847a;
  --accent: #6b8f71;
  --accent-hover: #5a7d60;
  --accent-light: rgba(107,143,113,0.12);
  --border: #cdc7ba;
  --border-light: #dad5cb;
  --green: #6b8f71;
  --yellow: #c49a2a;
  --red: #c25d4e;
  --shadow-sm: 0 1px 3px rgba(0,0,0,0.06);
  --shadow-md: 0 4px 12px rgba(0,0,0,0.08);
  --shadow-lg: 0 12px 40px rgba(0,0,0,0.12);
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --transition: 0.15s ease;
}
```

### Example Component Prompts

1. **"Build a settings dialog"** — 460px wide modal on blurred overlay (rgba(0,0,0,0.2) + blur(4px)). Parchment background, 28px padding, 12px radius, large shadow. Title at 16px semibold. Form fields with 9px 12px padding, 8px radius, light border. Focus ring: 3px accent-light spread. Primary button in sage green, secondary in surface color. SlideUp entrance animation.

2. **"Build a sidebar section"** — Secondary background (`#e8e4dc`), section header at 14px semibold uppercase with 0.8px tracking. List items at 15px medium, 10px 12px padding, 8px radius. Active state: accent-light background + 3px solid sage-green left border. 2px margin between items.

3. **"Build a toast notification"** — Fixed bottom-right (20px offset), max 360px wide, 10px 16px padding, 8px radius, large shadow. 12px text. Background varies by type: neutral (parchment), success (soft green), error (soft red), attention (soft yellow). ToastIn animation: translateY(8px) + scale(0.96) → origin.

4. **"Build a status indicator"** — 8×8px circle. Colors: active `#34a853` with 2s pulse, idle `#a0998f` static, waiting `#e8a735` with 1.5s pulse, exited `#c0392b`, disconnected `#c0392b` at 50% opacity.

5. **"Build a floating action button"** — 36×36px circle, sage green background, white icon, medium shadow. Hover: scale(1.08), shadow upgrades to large. Alternative: glassmorphic variant with `rgba(60,110,75,0.65)` + `backdrop-filter: blur(12px)` + breathe animation.

### Design Checklist

- [ ] All backgrounds use the warm parchment palette, never cold white or dark
- [ ] Text uses warm brown (`#3b3833`), never pure black
- [ ] Interactive elements use sage green accent, nothing else
- [ ] Focus rings are consistent: 3px spread in accent-light
- [ ] Depth comes from background stepping, not shadows (except Level 4 overlays)
- [ ] Animations are subtle ease transitions, 0.1–0.25s duration
- [ ] Terminal theme matches the UI palette
- [ ] No dark mode elements
- [ ] 13px for buttons and controls, 15px for content labels
